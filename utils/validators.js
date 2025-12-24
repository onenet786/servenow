const { body, query, param, validationResult } = require('express-validator');

const userValidators = {
    register: [
        body('firstName').trim().isLength({ min: 2 }).withMessage('First name must be at least 2 characters'),
        body('lastName').trim().isLength({ min: 2 }).withMessage('Last name must be at least 2 characters'),
        body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
        body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number')
    ],
    login: [
        body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    ],
    update: [
        body('firstName').optional().trim().isLength({ min: 2 }).withMessage('First name must be at least 2 characters'),
        body('lastName').optional().trim().isLength({ min: 2 }).withMessage('Last name must be at least 2 characters'),
        body('email').optional().isEmail().normalizeEmail().withMessage('Please provide a valid email'),
        body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number')
    ]
};

const storeValidators = {
    create: [
        body('name').trim().isLength({ min: 2 }).withMessage('Store name must be at least 2 characters'),
        body('location').trim().isLength({ min: 5 }).withMessage('Location must be at least 5 characters'),
        body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
        body('email').optional().isEmail().withMessage('Please provide a valid email')
    ],
    update: [
        body('name').optional().trim().isLength({ min: 2 }).withMessage('Store name must be at least 2 characters'),
        body('location').optional().trim().isLength({ min: 5 }).withMessage('Location must be at least 5 characters'),
        body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
        body('email').optional().isEmail().withMessage('Please provide a valid email')
    ]
};

const productValidators = {
    create: [
        body('name').trim().isLength({ min: 2 }).withMessage('Product name must be at least 2 characters'),
        body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
        body('cost_price').optional().isFloat({ min: 0 }).withMessage('Cost price must be a positive number'),
        body('quantity').isInt({ min: 0 }).withMessage('Quantity must be a non-negative integer'),
        body('store_id').isInt({ min: 1 }).withMessage('Valid store ID required'),
        body('category_id').optional().isInt({ min: 1 }).withMessage('Valid category ID required'),
        body('description').optional().trim()
    ],
    update: [
        body('name').optional().trim().isLength({ min: 2 }).withMessage('Product name must be at least 2 characters'),
        body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a positive number'),
        body('cost_price').optional().isFloat({ min: 0 }).withMessage('Cost price must be a positive number'),
        body('quantity').optional().isInt({ min: 0 }).withMessage('Quantity must be a non-negative integer'),
        body('description').optional().trim()
    ]
};

const orderValidators = {
    create: [
        body('store_id').isInt({ min: 1 }).withMessage('Valid store ID required'),
        body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
        body('items.*.product_id').isInt({ min: 1 }).withMessage('Valid product ID required'),
        body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
        body('delivery_address').trim().isLength({ min: 10 }).withMessage('Delivery address must be at least 10 characters')
    ]
};

const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array()
        });
    }
    next();
};

module.exports = {
    userValidators,
    storeValidators,
    productValidators,
    orderValidators,
    validateRequest
};
