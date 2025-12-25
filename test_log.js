const { logError } = require('./utils/debugLogger');
logError('Test Context', new Error('Test Error'));
console.log('Logged successfully');
