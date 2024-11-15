const express = require('express');

const { MongoClient } = require('mongodb');
const connectToDatabase = require('./startup/db');
const app = express();

const uri = 'mongodb://localhost'; 
const dbName = 'BusBookingDB'; 


app.use(express.json());
async function startServer() {
 
    
    const db = await connectToDatabase();

    app.locals.db = db; 

    require('./startup/routes')(app); 

    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Listening on port ${port}...`));
 
}

startServer();
