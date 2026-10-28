const mysql = require('mysql2/promise');
async function f() {
    try {
        const c = await mysql.createConnection({host:'localhost',user:'root',password:'',database:'servenow'});
        const [rows] = await c.execute('SHOW TABLES');
        console.log('Tables in servenow:', rows.map(r => Object.values(r)[0]));
        await c.end();
    } catch (e) {
        console.error(e.message);
    }
}
f();
