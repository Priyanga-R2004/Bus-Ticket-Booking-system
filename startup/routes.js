const express = require('express');
const buses = require('../routes/buses');
const users=require('../routes/users');
const error = require('../middleware/error.js');
const logger = require('../middleware/logger'); 

module.exports = function(app){
    console.log('routes');
    app.use('/api',buses);
    app.use('/api/users',users);
    
    app.use((req, res) => {
    res.status(404).send({ message: 'Route not found' });});

    app.use(error);
}

