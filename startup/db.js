
const { MongoClient } = require('mongodb');

const uri = 'mongodb://localhost'; 
const dbName = 'BusReservationDB'; 

let dbConnection;

async function connectToDatabase() {
  if (dbConnection) {
    return dbConnection;
  }

  try {
    
    const client = new MongoClient(uri);

    await client.connect();
    dbConnection = client.db(dbName);
    console.log('Successfully connected to MongoDB');

    return dbConnection;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1); 
  }
}

module.exports = connectToDatabase;
