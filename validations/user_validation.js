const Joi = require('joi');


const registerSchema = Joi.object({
  name: Joi.string().min(3).required(),
  age: Joi.number().integer().min(1).max(120).required(), 
  gender: Joi.string().valid('Male', 'Female', 'Other').required(),
  mobile: Joi.string().length(10).pattern(/^[0-9]+$/).required(),
  email: Joi.string()
    .pattern(new RegExp(/^[a-z]+@[a-z]+\.[a-z]{2,4}$/))
    .required(),
  password: Joi.string()
    .min(8)
    .pattern(new RegExp("^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])")) 
    .required(),
  is_admin:Joi.boolean()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(1).required(),
});
const bookTicketSchema = Joi.object({
  busId: Joi.string().required(),
  email: Joi.string()
    .pattern(new RegExp(/^[a-z]+@[a-z]+\.[a-z]{2,4}$/))
    .required(),

});

module.exports = {
  registerSchema,
  bookTicketSchema,
  loginSchema
};
