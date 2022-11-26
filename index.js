require("dotenv").config();
const express = require("express");
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const jwt = require("jsonwebtoken");

// stripe key require

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// middle ware
app.use(cors());
app.use(express.json());

// mongo db

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.lnnhqxo.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const AuthHeader = req.headers.authorization;

  if (!AuthHeader) {
    return res.status(401).send({ message: "UnAuthorized accessed" });
  }
  const token = AuthHeader.split(" ")[1];
  jwt.verify(token, process.env.SERCRET_KEY, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

async function run() {
  try {
    const appoinmentOptionsCollection = client
      .db("doctorsPortal")
      .collection("appointmentOptions");

    const bookingCollections = client
      .db("doctorsPortal")
      .collection("bookings");

    const userCollections = client.db("doctorsPortal").collection("users");
    const doctorsCollections = client.db("doctorsPortal").collection("doctors");
    const paymentCollections = client.db("doctorsPortal").collection("payment");

    // verify admin token after jwttoken

    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await userCollections.findOne(query);
      if (user?.role !== "admin") {
        res.status(403).send({ message: "forbidden" });
      }
      next();
    };

    app.get("/appoinmentOptions", async (req, res) => {
      const date = req.query.date;
      const query = {};
      const cursor = appoinmentOptionsCollection.find(query);
      const appointmentOptions = await cursor.toArray();
      const bookingQuery = { appointment: date };
      const alreadyBooked = await bookingCollections
        .find(bookingQuery)
        .toArray();

      appointmentOptions.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatmentName === option.name
        );
        const bookedSlots = optionBooked.map((slot) => slot.timeSlot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );

        option.slots = remainingSlots;
      });
      res.send(appointmentOptions);
    });

    // bookings api
    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: "Forbidden" });
      }
      const query = { email: email };
      const bookings = await bookingCollections.find(query).toArray();

      res.send(bookings);
    });

    app.post("/bookings", async (req, res) => {
      const bookings = req.body;
      const query = {
        email: bookings.email,
        appointment: bookings.appointment,
        treatmentName: bookings.treatmentName,
      };
      const alreadyBooked = await bookingCollections.find(query).toArray();
      if (alreadyBooked.length) {
        const message = `You have already booked for ${bookings.appointment}`;
        return res.send({ acknowledged: false, message });
      }
      const result = await bookingCollections.insertOne(bookings);
      res.send(result);
    });

    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await bookingCollections.findOne(query);
      res.send(result);
    });

    app.delete("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await bookingCollections.deleteOne(query);
      res.send(result);
    });

    // user api
    app.post("/users", async (req, res) => {
      const user = req.body;

      const query = { email: user.email };

      const existedUser = await userCollections.findOne(query);
      if (existedUser) {
        res.send({ acknowledged: "existed" });
        return;
      }
      const result = await userCollections.insertOne(user);
      res.send(result);
    });

    app.get("/users", async (req, res) => {
      const query = {};
      const allUsers = await userCollections.find(query).toArray();
      res.send(allUsers);
    });

    //  jwt
    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await userCollections.findOne(query);
      if (user && user?.email) {
        const token = jwt.sign({ email }, process.env.SERCRET_KEY, {
          expiresIn: "1d",
        });
        return res.send({ accessToken: token });
      }
      return res.status(401).send({ accessToken: "" });
    });

    // admin  api

    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollections.findOne(query);
      return res.send({ isAdmin: user?.role === "admin" });
    });

    app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updatedoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollections.updateOne(
        filter,
        updatedoc,
        options
      );
      res.send(result);
    });

    // doctorspeciality api

    app.get("/doctorspeciality", async (req, res) => {
      const query = {};
      const result = await appoinmentOptionsCollection
        .find(query)
        .project({ name: 1 })
        .toArray();
      res.send(result);
    });

    app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = req.body;
      const result = await doctorsCollections.insertOne(doctors);
      res.send(result);
    });

    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const decodedEmail = req.decoded.email;

      const query = {};
      const doctors = await doctorsCollections.find(query).toArray();
      res.send(doctors);
    });

    app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await doctorsCollections.deleteOne(query);
      res.send(result);
    });

    // temporary to update appointment options
    app.get("/addprice", async (req, res) => {
      const filter = {};
      const options = { upsert: true };
      const updatedoc = {
        $set: {
          price: 99,
        },
      };
      const result = await appoinmentOptionsCollection.updateMany(
        filter,
        updatedoc,
        options
      );
      res.send(result);
    });

    // payment api

    app.post("/create-payment-intent", async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        currency: "usd",
        amount: amount,
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentCollections.insertOne(payment);
      const id = payment.bookingId;
      const filter = { _id: ObjectId(id) };
      const updatedoc = {
        $set: {
          paid: true,
          transectionId: payment.transectionId,
        },
      };
      const bookingPaid = await bookingCollections.updateOne(filter, updatedoc);
      res.send(result);
    });

    // finally
  } finally {
  }
}
run().catch((error) => console.log(error.message));

// mongo db

app.get("/", async (req, res) => {
  res.send("doctor server initialized");
});

app.listen(port, () => {
  console.log("server running on port", port);
});
