const Joi = require('joi');

const stopSchema = Joi.object({
  location: Joi.string().required(),
  time: Joi.date().iso().required().custom((value, helpers) => {
    const today = new Date();
    const inputDate = new Date(value);

    if (inputDate <= today) {
      return helpers.message('Date must be in the future.');
    }

    return value;
  }), 
  price: Joi.object().pattern(
    Joi.string(), Joi.number()
  ).optional() 
});

const routeSchema = Joi.object({
  from: Joi.string().required(),
  to: Joi.string().required(),
  stops: Joi.array().items(stopSchema).required()
});

const addBusSchema = Joi.object({
  bus_name: Joi.string().required(),
  bus_number: Joi.string().required(),
  total_seats: Joi.number().integer().required(),
  seat_availability: Joi.array().items(Joi.string()).required(),
  route: routeSchema.required(),
  features: Joi.array().items(Joi.string()).optional() 
});



const findRoutesSchema = Joi.object({
  date: Joi.string()
    .required()
    .custom((value, helpers) => {
      const today = new Date();
      const inputDate = new Date(value);

      if (inputDate <= today) {
        return helpers.message('Date must be in the future.');
      }

      return value;
    }), 
  from: Joi.string().required(),
  to: Joi.string().required(),
  features: Joi.alternatives().try(
    Joi.array().items(Joi.string().valid('AC', 'Sleeper', 'Seater','WiFi')),
    Joi.string().valid('AC', 'Sleeper', 'Seater','WiFi')
  ).optional(),
})
  .custom((value, helpers) => {
    if (value.from === value.to) {
      return helpers.message('From and To locations must not be the same.');
    }
    return value;
  }); 

const bookSeatSchema = Joi.object({
  bus_id: Joi.string().required().hex().length(24),
  from: Joi.string().required(),
  to: Joi.string().required(),
  
  seat_numbers: Joi.array()
    .items(
      Joi.object({
        seat_number: Joi.string().required(),
        name: Joi.string().required(),
        age: Joi.number().integer().min(1).required(),
        gender: Joi.string().valid('Male', 'Female', 'Other').required()
      })
    )
    .min(1)
    .unique((a, b) => 
      a.seat_number === b.seat_number ||
      (a.name === b.name &&
      a.age === b.age &&
      a.gender === b.gender)
    ) 
    .required()
});




const paymentSchema = Joi.object({
  payment_id: Joi.string().required(),  
  account_details: Joi.object({
    payment_method: Joi.string().valid('credit_card', 'debit_card', 'paypal').required(),  
    card_number: Joi.string().required(),  
    expiry_date: Joi.string().pattern(/^(0[1-9]|1[0-2])\/\d{2}$/).required(),  
    cvv: Joi.string().length(3).pattern(/^[0-9]{3}$/).required()  
  }).required()
});
  const feedbackSchema = Joi.object({
    bus_id: Joi.string().required().messages({
      'string.empty': 'Bus ID is required.',
      'any.required': 'Bus ID is required.'
    }),
    review_msg: Joi.string().min(5).max(500).required().messages({
      'string.empty': 'Review message is required.',
      'string.min': 'Review message should be at least 5 characters long.',
      'string.max': 'Review message should not exceed 500 characters.',
      'any.required': 'Review message is required.'
    })
  });
  module.exports = {
    addBusSchema,
    findRoutesSchema,
    bookSeatSchema,
    paymentSchema,
    feedbackSchema
    
    
  };