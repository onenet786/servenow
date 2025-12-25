const fs = require('fs');
const path = require('path');

const logError = (context, error) => {
    const logPath = path.join(__dirname, '..', 'error_debug.log');
    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : 'No stack trace';
    
    const logEntry = `[${timestamp}] CONTEXT: ${context}\nERROR: ${errorMessage}\nSTACK: ${errorStack}\n-----------------------------------\n`;
    
    try {
        fs.appendFileSync(logPath, logEntry);
    } catch (e) {
        console.error('Failed to write to debug log:', e);
    }
};

module.exports = { logError };
