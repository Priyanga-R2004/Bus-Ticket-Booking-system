const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const connectToDatabase = require('../startup/db'); 
const { ObjectId } = require("mongodb");

const JWT_SECRET = process.env.JWT_SECRET || 'my_secret_key';
const { registerSchema,loginSchema } = require('../validations/user_validation');


router.post('/register', async (req, res) => {
  const { error } = registerSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  const { name, age, gender, mobile, email, password,is_admin} = req.body;
    const db = await connectToDatabase();
    const usersCollection = db.collection('users');
    const existingUser = await usersCollection.findOne({ email: email, mobile: mobile  });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      name,
      age,
      gender,
      mobile,
      email,
      password: hashedPassword,
      is_admin
    };
    
    const result = await usersCollection.insertOne(newUser);
    res.status(201).json({
      message: 'User created successfully' 
    });
  
});


router.post("/login", async (req, res) => {
  const { error } = loginSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  const { email, password } = req.body;
  const db = req.app.locals.db;
  const collection = db.collection("users");
  const user = await collection.findOne({ email });

  if (!user) {
    return res.status(400).json({ message: "Invalid email or password" });
  }
  
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return res.status(400).json({ message: "Invalid email or password" });
  }

  const accessToken = jwt.sign(
    { userId: user._id, email: user.email, is_admin: user.is_admin },
    JWT_SECRET,
    { expiresIn: "30m" }
  );

  const refreshToken = jwt.sign(
    { userId: user._id, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }  
  );


  res.header('x-auth-token', accessToken).status(200).json({
    message: "Login successful",
    accessToken,
    refreshToken,
  });
});

router.post("/refresh-token", async (req, res) => {
  const refreshToken = req.header("x-refresh-token");

  if (!refreshToken) {
    return res.status(401).json({ message: "No refresh token provided." });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    const db = req.app.locals.db;
    const collection = db.collection("users");
    const user = await collection.findOne({ _id: ObjectId.createFromHexString(decoded.userId) });

    if (!user) {
      return res.status(401).json({ message: "User not found." });
    }

    const newAccessToken = jwt.sign(
      { userId: user._id, email: user.email, is_admin: user.is_admin },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    const newRefreshToken = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      message: "New access token generated.",
      newAccessToken,
      newRefreshToken,
    });
  } catch (err) {
    console.error('Error verifying refresh token:', err);
    return res.status(400).json({ message: "Invalid refresh token." });
  }
});

module.exports = router;



