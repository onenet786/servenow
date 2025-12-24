const sendSuccess = (res, data = null, message = 'Success', statusCode = 200) => {
    const response = {
        success: true,
        message
    };
    if (data) {
        if (Array.isArray(data)) {
            response.data = data;
        } else if (typeof data === 'object') {
            Object.assign(response, data);
        }
    }
    return res.status(statusCode).json(response);
};

const sendError = (res, message = 'An error occurred', statusCode = 400, errors = null) => {
    const response = {
        success: false,
        message
    };
    if (errors) {
        response.errors = errors;
    }
    return res.status(statusCode).json(response);
};

const sendValidationError = (res, errors) => {
    return sendError(res, 'Validation failed', 400, errors.array());
};

const sendUnauthorized = (res, message = 'Unauthorized') => {
    return sendError(res, message, 401);
};

const sendForbidden = (res, message = 'Forbidden') => {
    return sendError(res, message, 403);
};

const sendNotFound = (res, message = 'Resource not found') => {
    return sendError(res, message, 404);
};

const sendServerError = (res, error = null) => {
    const message = process.env.NODE_ENV === 'development' ? (error ? error.message : 'Server error') : 'Internal server error';
    return sendError(res, message, 500);
};

module.exports = {
    sendSuccess,
    sendError,
    sendValidationError,
    sendUnauthorized,
    sendForbidden,
    sendNotFound,
    sendServerError
};
