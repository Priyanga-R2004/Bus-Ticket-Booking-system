const Joi = require('joi');


const stopSchema = Joi.object({
  location: Joi.string().required(),
  time: Joi.date()
    .iso()
    .greater('now')
    .required()
    .messages({
      'date.greater': 'Date must be in the future.',
    }),
  price: Joi.object()
    .pattern(Joi.string(), Joi.number().positive())
    .optional(),
});


const routeSchema = Joi.object({
  from: Joi.string().required(),
  to: Joi.string().required(),
  stops: Joi.array().items(stopSchema).required(),
});


const addBusRouteSchema = Joi.object({
  bus_id: Joi.string()
    .hex().length(24)
    .required(),
    
  route: routeSchema.required(),
 
});

const addBusSchema = Joi.object({
  bus_name: Joi.string().required(),
  bus_number: Joi.string().required(),
  total_seats: Joi.number().integer().positive().required(),
  seat_availability: Joi.array()
    .items(Joi.string())
    .required()
    .length(Joi.ref("total_seats"))
    .messages({
      "array.length": "'seat_availability' must have exactly {#limit} entries to match 'total_seats'."
    }),
  features: Joi.array()
    .items(
      Joi.string().valid("Seater", "Sleeper", "WiFi", "AC", "Charging Port")
    )
    .required()
    .min(1)
    .messages({
      "array.min": "At least one feature is required.",
      "any.only": "Features can include 'Seater', 'Sleeper', 'WiFi', 'AC', or 'Charging Port'.",
    })
  
});



const findRoutesSchema = Joi.object({
  date: Joi.date()
    .greater('now') 
    .required()
    .messages({ 'date.greater': 'Date must be in the future.' }),
  from: Joi.string().required(),
  to: Joi.string()
    .required()
    .not(Joi.ref('from')) 
    .messages({ 'any.invalid': 'From and To locations must not be the same.' }),
  features: Joi.alternatives()
    .try(
      Joi.array().items(Joi.string().valid("Seater", "Sleeper", "WiFi", "AC", "Charging Port")),
      Joi.string().valid("Seater", "Sleeper", "WiFi", "AC", "Charging Port")
    )
    .optional(),
});

const bookSeatSchema = Joi.object({
  bus_result_id: Joi.string().required().hex().length(24), 
  from: Joi.string().required(),
  to: Joi.string().required(),
  seat_numbers: Joi.array()
    .items(
      Joi.object({
        seat_number: Joi.string().required(), 
        name: Joi.string().required(), 
        age: Joi.number().integer().min(1).max(120).required(), 
        gender: Joi.string().valid('Male', 'Female', 'Other').required() 
      })
    )
    .min(1) 
    .unique('seat_number') 
    .required() 
});




const paymentSchema = Joi.object({
  payment_id: Joi.string().required(),  
  account_details: Joi.object({
    payment_method: Joi.string()
      .valid('credit_card', 'debit_card', 'paypal')
      .required(),
    card_number: Joi.string()
      //.creditCard() 
      .required(),
    expiry_date: Joi.string()
      .pattern(/^(0[1-9]|1[0-2])\/\d{2}$/) 
      .required()
      .messages({
        'string.pattern.base': 'Expiry date must be in MM/YY format.',
      }),
    cvv: Joi.string()
      .length(3)
      .pattern(/^[0-9]{3}$/) 
      .required()
      .messages({
        'string.pattern.base': 'CVV must be a 3-digit number.',
      })
  }).required()
});

const feedbackSchema = Joi.object({
  bus_id: Joi.string().required().messages({
    'any.required': 'Bus ID is required.',
    'string.empty': 'Bus ID cannot be empty.',
  }),
  review_msg: Joi.string()
    .min(5)
    .max(500)
    .required()
    .messages({
      'string.empty': 'Review message cannot be empty.',
      'string.min': 'Review message must be at least 5 characters long.',
      'string.max': 'Review message cannot exceed 500 characters.',
      'any.required': 'Review message is required.',
    })
});

  module.exports = {
    addBusRouteSchema,
    addBusSchema,
    findRoutesSchema,
    bookSeatSchema,
    paymentSchema,
    feedbackSchema
    
    
  };