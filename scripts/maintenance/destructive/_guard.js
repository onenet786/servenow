// Safety guard for scripts that delete or overwrite data.
// Refuses to run in production, and elsewhere requires an explicit confirmation:
//   CONFIRM_DESTRUCTIVE=yes node scripts/maintenance/destructive/<script>.js
// Take a database backup first.
require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run a destructive maintenance script with NODE_ENV=production.');
    process.exit(1);
}
if (process.env.CONFIRM_DESTRUCTIVE !== 'yes') {
    console.error(`This script modifies or deletes data in database "${process.env.DB_NAME}" on ${process.env.DB_HOST}.`);
    console.error('Back up the database, then re-run with CONFIRM_DESTRUCTIVE=yes to proceed.');
    process.exit(1);
}
