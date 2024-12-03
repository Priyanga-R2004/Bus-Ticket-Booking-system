const express = require("express");
const router = express.Router();
const auth=require('../middleware/auth');
const admin=require('../middleware/admin');
const { ObjectId } = require("mongodb");
const { getCollection, COLLECTIONS ,connectToDatabase} = require("../startup/db");
const Joi = require('joi');
const { addBusRouteSchema, addBusSchema, findRoutesSchema,bookSeatSchema,paymentSchema,feedbackSchema} = require('../validations/bus_validation');
const { v4: uuidv4 } = require("uuid");
const bcrypt = require('bcrypt');
const saltRounds = 10;

router.post("/add", [auth, admin], async (req, res) => {
  const { error } = addBusSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
 
  const collection = await getCollection(COLLECTIONS.BUSES);

  const { bus_number } = req.body;

  const existingBus = await collection.findOne({ bus_number });
  if (existingBus) {
    return res.status(400).json({
      error: `Bus with number ${bus_number} already exists.`,
    });
  }

  const busDocument = req.body;
  const result = await collection.insertOne(busDocument);
  res.status(201).json({
    message: "Bus added successfully.",
    bus: busDocument,
  });
});
const validateBusStops = (busDocument) => {
  const currentTime = new Date(); 
  console.log(currentTime);
  const stopLocations = busDocument.route.stops.map(stop => stop.location);
  for (let i = 0; i < busDocument.route.stops.length; i++) {
    const currentStop = busDocument.route.stops[i];

    if (currentStop.time <= currentTime) {
      return {
        valid: false,
        error: `Stop time for ${currentStop.location} should be a future time. Given time: ${currentStop.time}`
      };
    }
    if (currentStop.price) {
      for (let location in currentStop.price) {
        if (!stopLocations.includes(location)) {
          return {
            valid: false,
            error: `Location ${location} in price key not found in stops list.`
          };
        }
      }
    }
   
    for (let j = i + 1; j < busDocument.route.stops.length; j++) {
      const futureStop = busDocument.route.stops[j];

      // Check if the future stop has a price defined for it
      if (!currentStop.price || !currentStop.price[futureStop.location]) {
        return {
          valid: false,
          error: `Missing price key for future stop: ${futureStop.location} from ${currentStop.location}`
        };
      }

      if (futureStop.time <= currentStop.time) {
        
        return {
          valid: false,
          error: `Stop time for ${futureStop.location} should be after ${currentStop.location}. Given time: ${futureStop.time}`
        };
      }
    }
  }

  return { valid: true };
};

router.get("/find",async (req, res) => {
  const collection = await getCollection(COLLECTIONS.BUSROUTES);
  const result = await collection.find({}).toArray(); 
  res.status(200).json({ result });

});

router.post("/addbus", [auth, admin], async (req, res) => {
  const { error } = addBusRouteSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const busDocument = req.body;
  const { bus_id } = busDocument;
  const objectIdBus = ObjectId.createFromHexString(bus_id); 
  const collectionBus = await getCollection(COLLECTIONS.BUSES);
  const bus = await collectionBus.findOne({ _id: ObjectId.createFromHexString(bus_id) });

  const seat_availability = bus.seat_availability;
  busDocument.route.stops = busDocument.route.stops.map(stop => ({
    ...stop,
    time: new Date(stop.time),
    seat_availability,
  }));

  const collection = await getCollection(COLLECTIONS.BUSROUTES);

  const { from } = busDocument.route;
  const startStop = busDocument.route.stops[0];
  const startTime = new Date(startStop.time);
  const endStop = busDocument.route.stops[busDocument.route.stops.length - 1];
  const endTime = new Date(endStop.time);

  const existingBus = await collection.findOne({
    bus_id: objectIdBus,
    "route.from": from,
    "route.stops.0.time": startTime,
    "route.stops": {
      $elemMatch: { location: endStop.location, time: endTime }
    }
  });

  if (existingBus) {
    return res.status(400).json({ error: "Bus with the same bus number, starting location, and time already exists." });
  }

  const validationResult = validateBusStops(busDocument);
  if (!validationResult.valid) {
    return res.status(400).json({ error: validationResult.error });
  }
  busDocument.bus_id=objectIdBus;
  const result = await collection.insertOne(busDocument);

  res.status(201).json({
    message: "Bus inserted successfully",
    insertedId: result.insertedId,
  });
});


router.get("/routes", async (req, res) => {
  const { error } = findRoutesSchema.validate(req.query);

  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const { date, from, to, features } = req.query;
  const featureList = features ? (Array.isArray(features) ? features : [features]) : [];


  const startDate = new Date(date + "T00:00:00Z");
  const endDate = new Date(date + "T23:59:59Z");

  console.log(req.query, startDate.toISOString(), endDate.toISOString());

  const pipeline = [

    {
      $match: {
        "route.stops.time": {
          $gte: startDate,  
          $lt: endDate     
        },
        "route.stops": {
          $elemMatch: {
            location: from 
          },
          $elemMatch: {
            location: to 
          }
        }
      }
    },
    {
      $addFields: {
        fromIndex: { $indexOfArray: ["$route.stops.location", from] },
        toIndex: { $indexOfArray: ["$route.stops.location", to] }
      }
    },
    // Ensure that "to" comes after "from"
    {
      $match: {
        $expr: { $lt: ["$fromIndex", "$toIndex"] }
      }
    },
   
    {
      $lookup: {
        from: COLLECTIONS.BUSES,
        localField: "bus_id",
        foreignField: "_id",
        as: "bus_details"
      }
    },
    
    {
      $unwind: "$bus_details"
    },

    ...(featureList.length > 0 ? [{
      $match: {
        "bus_details.features": { $all: featureList } 
      }
    }] : []),
    {
      $match: {
        $expr: { $gt: [{ $size: { $arrayElemAt: ["$route.stops.seat_availability", { $indexOfArray: ["$route.stops.location", from] }] } }, 0] }
      }
    },

    {
      $project: {
        bus_id: "$bus_details._id",
        bus_name: "$bus_details.bus_name",
        bus_number: "$bus_details.bus_number",
        from_location: from, 
        to_location: to,
        departure_time: { 
          $arrayElemAt: ["$route.stops.time", { $indexOfArray: ["$route.stops.location", from] }] 
        },
        features: "$bus_details.features",
        available_seats: { 
          $arrayElemAt: ["$route.stops.seat_availability", { $indexOfArray: ["$route.stops.location", from] }] 
        },
        total_price: { 
          $arrayElemAt: ["$route.stops.price." + to, { $indexOfArray: ["$route.stops.location", from] }] 
        }
      }
    },
    
    {
      $sort: { total_price: 1 }
    }
  ];

  const collection = await getCollection(COLLECTIONS.BUSROUTES);
  const buses = await collection.aggregate(pipeline).toArray();

  if (buses.length === 0) {
    return res.status(404).json({ message: "No buses found matching the criteria" });
  }

  res.status(200).json({ buses });
});

router.post('/book-seat', auth, async (req, res) => {
  const { error } = bookSeatSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const { bus_result_id, from, to, seat_numbers } = req.body;
  const route_id=ObjectId.createFromHexString(bus_result_id);

  const busCollection = await getCollection(COLLECTIONS.BUSROUTES);
  const bus = await busCollection.findOne({ _id: route_id });

  if (!bus) {
    return res.status(404).json({ error: 'Bus not found.' });
  }


  const fromIndex = bus.route.stops.findIndex(stop => stop.location === from);
  const toIndex = bus.route.stops.findIndex(stop => stop.location === to);

  if (fromIndex === -1 || toIndex === -1 || fromIndex >= toIndex) {
    return res.status(400).json({ error: 'Invalid Bus route.' });
  }


  const segmentPrice = bus.route.stops[fromIndex]?.price[to];
  if (!segmentPrice) {
    return res.status(400).json({ error: `No price defined from ${from} to ${to}.` });
  }
  const totalPrice = segmentPrice * seat_numbers.length;

  for (let i = fromIndex; i < toIndex; i++) {
    const stop = bus.route.stops[i];
    for (const seat of seat_numbers) {
      if (!stop.seat_availability.includes(seat.seat_number)) {
        return res.status(400).json({ error: `Seat ${seat.seat_number} is not available for the segment from ${from} to ${to}.` });
      }
    }
  }

  for (let i = fromIndex; i < toIndex; i++) {
    const stop = bus.route.stops[i];
    stop.seat_availability = stop.seat_availability.filter(
      s => !seat_numbers.some(seat => seat.seat_number === s)
    );
  }

  await busCollection.updateOne(
    { _id:route_id },
    { $set: { "route.stops": bus.route.stops } }
  );

  const paymentId = uuidv4();

  const departure_time=new Date(bus.route.stops[fromIndex].time);
  const booking = {
    payment_id: paymentId,
    bus_id: bus.bus_id,
    route_id:route_id,
    from,
    to,
    departure_time:departure_time,
    seat_numbers,
    no_of_seats: seat_numbers.length,
    total_price: totalPrice,
    user_id:  ObjectId.createFromHexString(req.user.userId),
    payment_status: 'pending',
    booking_date: new Date(),
    booking_status: 'booked'
  };


  const bookingCollection = await getCollection(COLLECTIONS.BOOKINGS);
  await bookingCollection.insertOne(booking);

  // Respond with the booking details
  res.status(200).json({
    payment_id: paymentId,
    total_price: totalPrice,
    no_of_seats: seat_numbers.length
  });
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
 
  
    const paymentCollection= await getCollection(COLLECTIONS.PAYMENTS);
    const existingPayment = await paymentCollection.findOne({ payment_id });
    if (existingPayment) {
      return res.status(400).json({ error: 'Payment already processed for this payment ID.' });
    }
  
    const bookingCollection = await getCollection(COLLECTIONS.BOOKINGS);
    const booking = await bookingCollection.findOne({ payment_id });
  
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
   const busrouteCollection = await getCollection(COLLECTIONS.BUSROUTES);
    const bus = await busrouteCollection.findOne({ _id: booking.route_id });
  
    if (!bus) {
      return res.status(404).json({ error: 'Bus Route not found.' });
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
      bus_id: bus.bus_id,  
      route_id:bus._id     
    };
  
    
    await paymentCollection.insertOne(paymentDetails);
  
    const updateBooking = await bookingCollection.updateOne(
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
 
    const user = req.user;
  const feedbackCollection =await getCollection(COLLECTIONS.FEEDBACKS);
  const busCollection=await getCollection(COLLECTIONS.BUSROUTES);
  const bookingCollection= await getCollection(COLLECTIONS.BOOKINGS)

    const busExists = await busCollection.findOne({ bus_id: ObjectId.createFromHexString(bus_id) });
    if (!busExists) {
      return res.status(404).json({ error: 'Bus not found.' });
    }

    const booking = await bookingCollection.findOne({
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
      user_id: ObjectId.createFromHexString(user.userId),
      bus_id: ObjectId.createFromHexString(bus_id),
      review_msg: review_msg,
      date: new Date(),
    };
  
   
    await feedbackCollection.insertOne(feedback);
  
    res.status(201).json({ message: 'Feedback submitted successfully.' });
  });
  

router.get('/feedback', [auth,admin], async (req, res) => {
  const { bus_id } = req.query;

  const feedbackCollection =await getCollection(COLLECTIONS.FEEDBACKS)
    const feedbacks = await feedbackCollection.find({ bus_id }).toArray();

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
        name: Joi.string().required()
      })
    ).required()
  }).validate(req.body);

  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const { booking_id, seats } = req.body;
  const user = req.user;

  const bookingCollection = await getCollection(COLLECTIONS.BOOKINGS);
  const busCollection = await getCollection(COLLECTIONS.BUSROUTES);
  const paymentCollection = await getCollection(COLLECTIONS.PAYMENTS);

  const booking = await bookingCollection.findOne({ booking_id });
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  if (booking.user_id.toString() !== user.userId) {
    return res.status(403).json({ error: 'You are not authorized to cancel this booking.' });
  }

  const bus = await busCollection.findOne({ _id: booking.route_id });
  if (!bus) {
    return res.status(404).json({ error: 'Bus route not found.' });
  }

  const canceledSeats = seats.map(seat => seat.seat_number);
  const remainingSeats = booking.seat_numbers.filter(seat => !canceledSeats.includes(seat.seat_number));
  console.log(remainingSeats)

  const refundAmount = (canceledSeats.length * booking.total_price) / booking.no_of_seats;
  const refundDetails = {
    refunded_seats: canceledSeats,
    refund_amount: refundAmount,
    refund_date: new Date()
  };

  
  const updateBookingResult = await bookingCollection.updateOne(
    { booking_id },
    {
      $set: {
        booking_status: remainingSeats.length > 0 ? 'partially_cancelled' : 'cancelled',
        payment_status: 'refunded',
        seat_numbers: remainingSeats,
        no_of_seats: remainingSeats.length
      }
    }
  );
  

  if (updateBookingResult.modifiedCount === 0) {
    return res.status(500).json({ error: 'Failed to cancel the booking.' });
  }


  const payment = await paymentCollection.findOne({ payment_id: booking.payment_id });
  if (payment) {
    const paymentUpdateResult = await paymentCollection.updateOne(
      { payment_id: booking.payment_id },
      {
        $set: {
          payment_status: 'refunded',
          refund_details: refundDetails,
          refund_amount: refundAmount
        }
      }
    );

    if (paymentUpdateResult.modifiedCount === 0) {
      return res.status(500).json({ error: 'Failed to update payment status.' });
    }
  }

  
  const fromIndex = bus.route.stops.findIndex(stop => stop.location === booking.from);
  const toIndex = bus.route.stops.findIndex(stop => stop.location === booking.to);

  if (fromIndex === -1 || toIndex === -1) {
    return res.status(404).json({ error: 'Invalid route stops.' });
  }

  for (let i = fromIndex; i < toIndex; i++) {
    const stop = bus.route.stops[i];

    if (!stop.seat_availability) {
      stop.seat_availability = [];
    }

    const updateBusResult = await busCollection.updateOne(
      { _id: bus._id },
      {
        $push: {
          'route.stops.$[stop].seat_availability': { $each: canceledSeats }
        }
      },
      {
        arrayFilters: [{ 'stop.location': stop.location }]
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
    refund_amount: refundAmount
  });
});


module.exports = router;