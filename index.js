const express = require('express')
const app = express()
const cors = require('cors');
const port = process.env.PORT || 5000;
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.1kye1ty.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// middle wires
app.use(cors());
app.use(express.json());

const verifyJWT = (req,res,next) => {
    const authHeader = req.headers.authorization;
    if(!authHeader){
        return res.status(401).send({message:'Unauthorized Access'})
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET,(err,decoded) =>{
        if (err) {
            return res.status(403).send({message: 'Forbidden Access'})
        }
        req.decoded = decoded;
        next();
    })
}


async function run() {
    try {
        await client.connect();
        const usersCollection = client.db('toolSea').collection('users');
        const reviewsCollection = client.db('toolSea').collection('reviews');

        //put user info on db while user logs in and issue a token for user
        app.put('/users/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email }
            const options = { upsert: true }
            const updatedDoc = {
                $set: user
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '1d'
            })
            res.send({ result, token });
        })
        //load specific user details
        app.get('/user/:email', verifyJWT, async(req,res)=>{
            const email = req.params.email;
            const query = {email:email};
            const user = await usersCollection.findOne(query);
            res.send(user);
        })
        //get reviews from user
        app.post('/review',verifyJWT, async(req,res)=>{
            const review = req.body;
            const result = await reviewsCollection.insertOne(review);
            res.send(result);
        })
        //load all the reviews reverse order with limit
        app.get('/review',verifyJWT, async(req,res)=>{
            // const query = {};
            // const reviews = await reviewsCollection.find(query).toArray();
            const reviews = await reviewsCollection.find().sort({$natural: -1 }).limit(6).toArray();
            res.send(reviews);
        })
    }
    finally {
        // await client.close()
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})