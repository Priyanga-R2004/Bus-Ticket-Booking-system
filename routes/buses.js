const express = require("express");
const router = express.Router();
const auth=require('../middleware/auth');
const admin=require('../middleware/admin');
const { ObjectId } = require("mongodb");
const Joi = require('joi');
const { addBusSchema, findRoutesSchema,bookSeatSchema,paymentSchema,feedbackSchema} = require('../validations/bus_validation');
const { v4: uuidv4 } = require("uuid");
const bcrypt = require('bcrypt');
const saltRounds = 10;

router.post("/bus/addbus", [auth, admin], async (req, res) => {
  const { error } = addBusSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const busDocument = req.body;
  const seat_availability = busDocument.seat_availability;
  delete busDocument.seat_availability;

  busDocument.route.stops = busDocument.route.stops.map(stop => ({
    ...stop,
    time: new Date(stop.time).toISOString(),
    seat_availability: [...seat_availability],
  }));

  const db = req.app.locals.db;
  const collection = db.collection("buses");

  const { from } = busDocument.route;
  const startStop = busDocument.route.stops[0];
  const startTime = startStop.time;
  const { bus_number } = busDocument;

  const existingBus = await collection.findOne({
    bus_number: bus_number,
    "route.from": from,
    "route.stops.0.time": startTime,
  });

  if (existingBus) {
    return res.status(400).json({ error: "Bus with the same bus number, starting location, and time already exists." });
  }

  const result = await collection.insertOne(busDocument);

  res.status(200).json({
    message: "Bus inserted successfully",
    insertedId: result.insertedId,
  });
});


router.post("/routes", async (req, res) => {
  const { error } = findRoutesSchema.validate(req.body); 

  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const db = req.app.locals.db;
  const { date, from, to, features } = req.body;
  const featureList = features ? (Array.isArray(features) ? features : [features]) : [];

  const query = {
    "route.stops.time": {
      $gte: new Date(date + "T00:00:00Z").toISOString(),
      $lt: new Date(date + "T23:59:59Z").toISOString()
    },
    ...(featureList.length > 0 && { features: { $all: featureList } })
  };

  // Fetch matching buses and send a response
  const buses = await db.collection("buses").find(query).toArray();
  if (buses.length === 0) {
    return res.status(404).json({ message: "No buses found matching the criteria" });
  }

  // Further processing and filtering based on boarding and dropping points
  const matchingBuses = buses.map(bus => {
    const stops = bus.route.stops;
    const boardingIndex = stops.findIndex(stop => stop.location === from);
    const droppingIndex = stops.findIndex(stop => stop.location === to);

    if (boardingIndex === -1 || droppingIndex === -1 || boardingIndex >= droppingIndex) {
      return null;
    }

    const price = stops[boardingIndex].price[to];
    if (!price) {
      return null;
    }

    return {
      bus_id: bus._id,
      bus_name: bus.bus_name,
      bus_number: bus.bus_number,
      departure_time: bus.route.stops[boardingIndex].time,
      boarding_point: from,
      dropping_point: to,
      features: bus.features,
      available_seats: stops[boardingIndex].seat_availability,
      total_price: price
    };
  }).filter(bus => bus !== null);

  if (matchingBuses.length === 0) {
    return res.status(404).json({ message: "No buses found with valid boarding and dropping points in sequence." });
  }

  res.status(200).json({ buses: matchingBuses.sort((a, b) => a.total_price - b.total_price) });
});



  router.post('/book-seat', auth, async (req, res) => {
    const { error } = bookSeatSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
  
    const { bus_id, from, to, seat_numbers } = req.body;
    const db = req.app.locals.db;
    const bus = await db.collection("buses").findOne({ _id: ObjectId.createFromHexString(bus_id) });
    if (!bus) return res.status(404).json({ error: 'Bus not found.' });
  
    const fromIndex = bus.route.stops.findIndex(stop => stop.location === from);
    const toIndex = bus.route.stops.findIndex(stop => stop.location === to);
  
    if (fromIndex === -1 || toIndex === -1 || fromIndex >= toIndex) {
      return res.status(400).json({ error: 'Invalid route.' });
    }
  
    const segmentPrice = bus.route.stops[fromIndex].price[to];
    if (!segmentPrice) {
      return res.status(400).json({ error: `No price defined from ${from} to ${to}.` });
    }
  
    const totalPrice = segmentPrice * seat_numbers.length;
  
    for (let i = fromIndex; i < toIndex; i++) {
      const stop = bus.route.stops[i];
      for (const seat of seat_numbers) {
        if (!stop.seat_availability.includes(seat.seat_number)) {
          return res.status(400).json({ error: `Seat ${seat.seat_number} is not available from ${from} to ${to}.` });
        }
      }
      stop.seat_availability = stop.seat_availability.filter(s => !seat_numbers.some(seat => seat.seat_number === s));
    }
  
    await db.collection("buses").updateOne(
      { _id: ObjectId.createFromHexString(bus_id) },
      { $set: { "route.stops": bus.route.stops } }
    );
  
    const paymentId = uuidv4();
  
    const newBooking = {
      payment_id: paymentId,
      bus_id: ObjectId.createFromHexString(bus_id), 
      from: from,
      to: to,
      seat_numbers: seat_numbers.map(seat => ({ seat_number: seat.seat_number })),
      no_of_seats: seat_numbers.length,
      total_price: totalPrice,
      user_id: ObjectId.createFromHexString(req.user.userId), 
      payment_status: 'pending',
      booking_date: new Date(),
      booking_status: 'booked'
    };
  
    await db.collection("bookings").insertOne(newBooking);
  
    const response = {
      payment_id: paymentId,
      total_price: totalPrice,
      no_of_seats: seat_numbers.length,
    };
  
    res.status(200).json(response);
  });
  

  router.post('/payment', auth, async (req, res) => {
    const { error } = paymentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
  
    const { payment_id, account_details } = req.body;
    const { payment_method, card_number, expiry_date, cvv } = account_details;
  
    const hashedCardNumber = await bcrypt.hash(card_number.slice(-4), saltRounds);  
    const hashedExpiryDate = await bcrypt.hash(expiry_date, saltRounds); 
    const hashedCVV = await bcrypt.hash(cvv, saltRounds);  
    const user = req.user;
    const db = req.app.locals.db;
  
    const existingPayment = await db.collection('payments').findOne({ payment_id });
    if (existingPayment) {
      return res.status(400).json({ error: 'Payment already processed for this payment ID.' });
    }
  
    const booking = await db.collection('bookings').findOne({ payment_id });
  
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
  
    const bus = await db.collection('buses').findOne({ _id: booking.bus_id });
  
    if (!bus) {
      return res.status(404).json({ error: 'Bus not found.' });
    }
  
    const booking_id = uuidv4();  
    
    
    const paymentDetails = {
      payment_id,
      booking_id,
      payment_status: 'success', 
      payment_date: new Date(),
      payment_method, 
      card_number: hashedCardNumber,  
      expiry_date: hashedExpiryDate,  
      cvv: hashedCVV,  
      user_id: ObjectId.createFromHexString(user.userId),  
      bus_id: bus._id,       
    };
  
    
    await db.collection('payments').insertOne(paymentDetails);
  
    const updateBooking = await db.collection('bookings').updateOne(
      { payment_id },
      {
        $set: {
          payment_status: 'success',
          booking_status: 'booked',
          booking_id,
        },
      }
    );
  
    if (updateBooking.modifiedCount === 0) {
      return res.status(500).json({ error: 'Failed to update payment status.' });
    }
  
    return res.status(200).json({
      message: 'Payment successful.',
      booking_id,
      payment_status: 'success',
      bus_id: bus._id,
      seats: booking.seat_numbers,
      total_price: booking.total_price,
    });
  });
  router.post('/feedback', auth, async (req, res) => {
    const { error } = feedbackSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
  
    const { bus_id, review_msg } = req.body;
    const db = req.app.locals.db;
    const user = req.user;
  
  
    const busExists = await db.collection('buses').findOne({ _id: ObjectId.createFromHexString(bus_id) });
    if (!busExists) {
      return res.status(404).json({ error: 'Bus not found.' });
    }
  
    const booking = await db.collection('bookings').findOne({
      user_id: ObjectId.createFromHexString(user.userId),
      bus_id: ObjectId.createFromHexString(bus_id),
      booking_status: 'booked',  
    });
  console.log(booking);
    if (!booking) {
      return res.status(403).json({ error: 'You must complete the journey before providing feedback.' });
    }
 
    const currentDate = new Date();
    const busStop = busExists.route.stops.find(stop => stop.location === booking.from); 
    const travelDate = new Date(busStop.time); 
  
    if (currentDate < travelDate) {
      return res.status(403).json({ error: 'You can only provide feedback after the journey is completed.' });
    }
  
    const feedback = {
      user_id: user.userId,
      bus_id: bus_id,
      review_msg: review_msg,
      date: new Date(),
    };
  
   
    await db.collection('feedbacks').insertOne(feedback);
  
    res.status(201).json({ message: 'Feedback submitted successfully.' });
  });
  

router.get('/feedback', [auth,admin], async (req, res) => {
  const { bus_id } = req.body;

  const db = req.app.locals.db;

    const feedbacks = await db.collection('feedbacks').find({ bus_id }).toArray();

    if (feedbacks.length === 0) {
      return res.status(404).json({ error: 'No feedback found for this bus.' });
    }

    return res.status(200).json({
      bus_id,
      feedbacks
    });

});


router.post('/cancel-booking', auth, async (req, res) => {
  const { error } = Joi.object({
    booking_id: Joi.string().required(),
    seats: Joi.array().items(
      Joi.object({
        seat_number: Joi.string().required(),
        name:Joi.string().required()
      })
    ).required()
  }).validate(req.body);
  
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const { booking_id, seats } = req.body;
  const user = req.user;
  const db = req.app.locals.db;

  const booking = await db.collection('bookings').findOne({ booking_id });
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  if (booking.user_id.toString() !== user.userId) {
    return res.status(403).json({ error: 'You are not authorized to cancel this booking.' });
  }

  const bus = await db.collection('buses').findOne({ _id: booking.bus_id });
  if (!bus) {
    return res.status(404).json({ error: 'Bus not found.' });
  }

  const canceledSeats = seats.map(seat => seat.seat_number);
  const remainingSeats = booking.seat_numbers.filter(seat => !canceledSeats.includes(seat.seat_number));
  
  
  const refundAmount = canceledSeats.length * booking.total_price / booking.no_of_seats;
  const refundDetails = {
    refunded_seats: canceledSeats,
    refund_amount: refundAmount,
    refund_date: new Date()
  };

  console.log("aaa");
  const updateBookingResult = await db.collection('bookings').updateOne(
    { booking_id },
    {
      $set: {
        booking_status: 'cancelled',
        payment_status: 'refunded',
        seat_numbers: remainingSeats,
      }
    }
  );

  if (updateBookingResult.modifiedCount === 0) {
    return res.status(500).json({ error: 'Failed to cancel the booking.' });
  }

  const payment = await db.collection('payments').findOne({ payment_id: booking.payment_id });
  if (payment) {
    const paymentUpdateResult = await db.collection('payments').updateOne(
      { payment_id: booking.payment_id },
      {
        $set: {
          payment_status: 'refunded',
          refund_details: refundDetails,
          refund_amount: refundAmount,
        }
      }
    );

    if (paymentUpdateResult.modifiedCount === 0) {
      return res.status(500).json({ error: 'Failed to update payment status.' });
    }
  }

  const routeStops = bus.route.stops;
  const fromIndex = routeStops.findIndex(stop => stop.location === from);
  const toIndex = routeStops.findIndex(stop => stop.location === to);

  if (fromIndex === -1 || toIndex === -1) {
    return res.status(404).json({ error: 'Invalid route stops.' });
  }

  for (let i = fromIndex; i <= toIndex; i++) {
    const stop = routeStops[i];
    
    if (!stop.seat_availability) {
      stop.seat_availability = []; 
    }
    
    
    const updateBusResult = await db.collection('buses').updateOne(
      { _id: ObjectId.createFromHexString(bus._id) },
      { 
        $push: {
          'route.stops.$[stop].seat_availability': { $each: canceledSeats }
        }
      },
      {
        arrayFilters: [{ 'stop.location': stop.location }] // Apply filter to match the stop
      }
    );
    
    if (updateBusResult.modifiedCount === 0) {
      return res.status(500).json({ error: 'Failed to update bus seat availability.' });
    }
  }
  
 
 

  return res.status(200).json({
    status: 'Booking successfully cancelled and payment refunded.',
    booking_id,
    bus_id: booking.bus_id,
    refunded_seats: canceledSeats,
    refund_amount: refundAmount,
  });
});


module.exports = router;