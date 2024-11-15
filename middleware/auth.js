const jwt = require('jsonwebtoken');
const config = require('config'); 

const JWT_SECRET = process.env.JWT_SECRET || 'my_secret_key'; 


module.exports = function (req, res, next) {
  const token = req.header('x-auth-token');
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    console.log("authentication successfull",req.user);
    next(); 
  } catch (err) {
    console.error('Invalid token:', err);
    return res.status(401).json({ error: 'Invalid token.' });
  }
};
