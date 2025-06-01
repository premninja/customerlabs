const app=require("express")();
const sqlite3=require("sqlite3").verbose()
const {open}=require("sqlite")
const axios = require('axios');
const port = 8000;
const bp=require("body-parser")
const crypto=require("crypto");
const { log } = require("console");
app.use(bp.json());
let sdb;
app.listen(port,async()=>{
sdb=await open({driver:sqlite3.Database,filename:"./data.db"})
console.log("SERVER started & DB connected");
await sdb.exec(`CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    app_secret TEXT NOT NULL,
    website TEXT
  )`);

  await sdb.exec(`CREATE TABLE IF NOT EXISTS destinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT,
    url TEXT NOT NULL,
    method TEXT NOT NULL,
    headers TEXT NOT NULL,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  )`);
})
/// create unqiue token 
const generateToken = () => new Date().toISOString().replaceAll("-","").replaceAll(":","").replace("T",'').replace(".",'').replace("Z",'')
console.log(generateToken());

// CRUD for Accounts

app.post('/accounts', async (req, res) => {
  const { email, name, website } = req.body;
  if (!email||!name)return res.status(400).send('Please fill the mandatory fields')

  const id = crypto.randomUUID();
  const app_secret = generateToken();
  try {
    await sdb.run(`INSERT INTO accounts (id, email, name, website, app_secret) VALUES (?, ?, ?, ?, ?)`, [id, email, name, website || '', app_secret]);
    res.json({ id, app_secret });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/accounts",async(req,res)=>{
    const result=await sdb.all("SELECT * FROM accounts");
    res.json(result)
})
app.delete('/accounts/:id', async (req, res) => {
  const { id } = req.params;
  console.log(id);
  
  if (!id)return res.status(400).send('invalid data')
  const check = await sdb.all('SELECT * FROM accounts WHERE id = ?', id);
// console.log(check);

if (check?.length>0){
    

  await sdb.run('DELETE FROM accounts WHERE id = ?', id);
  await sdb.run('DELETE FROM destinations WHERE account_id = ?', id);
  res.json({ message: 'Account and destinations deleted' });
  }else{
    res.status(400).send("unable to Delete")
  }
});

// CRUD for Destinations
app.post('/destinations', async (req, res) => {
  const { account_id, url, method, headers } = req.body;
    if (!url || !method || !headers ||!account_id)return res.status(400).send('invalid data')
    
  try {
    await sdb.run(`INSERT INTO destinations (account_id, url, method, headers) VALUES (?, ?, ?, ?)`, [account_id, url, method, JSON.stringify(headers)]);
    res.json({ message: 'Destination added' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/destinations/:account_id', async (req, res) => {
  const { account_id } = req.params;
      if (!account_id)return res.status(400).send('invalid data')

  const destinations = await sdb.all('SELECT * FROM destinations WHERE account_id = ?', account_id);
  res.json(destinations);
});


// Incoming data receiver
app.post('/server/incoming_data', async (req, res) => {

  const token = req.headers['cl-x-token'];

  if (!token) return res.status(401).json({ message: 'Un Authenticate' });

  const account = await sdb.get('SELECT * FROM accounts WHERE app_secret = ?', token);
  if (!account) return res.status(401).json({ message: 'Un Authenticate' });

  const destinations = await sdb.all('SELECT * FROM destinations WHERE account_id = ?', account.id);
  const data = req.body;

  for (const dest of destinations) {
    const headers = JSON.parse(dest.headers);
    try {
      if (dest.method.toLowerCase() === 'get') {
        await axios.get(dest.url, {
          headers,
          params: data
        });
      } else {
        await axios({
          method: dest.method.toLowerCase(),
          url: dest.url,
          data,
          headers
        });
      }
    } catch (err) {
      console.error(`Failed to send to ${dest.url}:`, err.message);
    }
  }
  res.json({ message: 'Data pushed to all destinations' });
});
