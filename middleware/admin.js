const jwt = require('jsonwebtoken');
const config = require('config');

const JWT_SECRET = process.env.JWT_SECRET || 'my_secret_key'; 
module.exports = function (req, res, next) {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).send('Access denied. No token provided.');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log("----------",decoded);
    if (!decoded.is_admin) {
      return res.status(403).send('Access denied. You are not an admin.');
    }

    req.user = decoded;
    
    next(); 
  } catch (ex) {
    return res.status(401).send('Invalid token.');
  }
};
