const express = require('express')
const app = express()
const cors = require('cors');
const port = process.env.PORT || 5000;
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.1kye1ty.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);


// middle wires
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized Access' })
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' })
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
        const productsCollection = client.db('toolSea').collection('products');
        const ordersCollection = client.db('toolSea').collection('orders');
        const paymentsCollection = client.db('toolSea').collection('payments');
        //verify admin
        const verifyADMIN = async (req, res, next) => {
            const requester = req.decoded.email;
            const requesterAccount = await usersCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin') {
                next();
            }
            else (
                res.status(403).send({ message: 'Forbidden Access' })
            )
        }
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
        //payment intent api
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const product = req.body;
            const price = product.totalPrice;
            const amount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'USD',
                payment_method_types: ['card']
            });
            res.send({clientSecret: paymentIntent.client_secret,});
        })
        //update payment info on db
        app.patch('/order/:id', verifyJWT, async(req,res)=>{
            const id =req.params.id;
            const payment =req.body;
            const filter = {_id: ObjectId (id)};
            const updatedDoc = {
                $set : {
                    paid:true,
                    transactionId: payment.transactionId
                }
            }
            const paymentResult = await ordersCollection.updateOne(filter, updatedDoc);
            const paymentCollection = await paymentsCollection.insertOne(payment);
            res.send(updatedDoc);
        })
        //make user admin
        app.put('/user/admin/:email', verifyJWT, verifyADMIN, async (req, res) => {
            const email = req.params.email; //whom should be admin
            const userRole = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updatedDoc = {
                $set: userRole
            };
            const result = await usersCollection.updateOne(filter, updatedDoc, options);
            res.send(result);

        })
        //load specific user details
        app.get('/user/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            res.send(user);
        })
        //load all user details
        app.get('/users', verifyJWT, verifyADMIN, async (req, res) => {
            const query = {};
            const users = await usersCollection.find(query).toArray()
            res.send(users);
        })
        //store user reviews to db
        app.post('/review', verifyJWT, async (req, res) => {
            const review = req.body;
            const result = await reviewsCollection.insertOne(review);
            res.send(result);
        })
        //load all the reviews reverse order with limit
        app.get('/review', verifyJWT, async (req, res) => {
            const reviews = await reviewsCollection.find().sort({ $natural: -1 }).limit(6).toArray();
            res.send(reviews);
        })
        //add new product to db
        app.post('/product', verifyJWT, verifyADMIN, async (req, res) => {
            const newProduct = req.body;
            const result = await productsCollection.insertOne(newProduct);
            res.send(result);
        })
        //delete product from db
        app.delete('/product/:id', verifyJWT, verifyADMIN, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = productsCollection.deleteOne(query);
            res.send(result);
        })
        //load 6 products for homepage
        app.get('/product', verifyJWT, async (req, res) => {
            const products = await productsCollection.find().sort({ $natural: -1 }).limit(6).toArray();
            res.send(products);
        })
        //load all the products for manage products
        app.get('/products', verifyJWT, verifyADMIN, async (req, res) => {
            const query = ({});
            const products = await productsCollection.find().toArray();
            res.send(products);
        })
        //load all the products for users
        app.get('/tools', verifyJWT, async (req, res) => {
            const query = ({});
            const products = await productsCollection.find().toArray();
            res.send(products);
        })
        //reduce stock and update min order quantity after order place
        app.put('/product/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const updatedQuantity = req.body;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    availableQuantity: updatedQuantity.availableQuantity,
                    minOrderQuantity: updatedQuantity.minOrderQuantity
                }
            }
            const result = await productsCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        })
        //update product available quantity/stock by admin
        app.put('/product/stock/:id', verifyJWT, verifyADMIN, async (req, res) => {
            const id = req.params.id;
            const updatedQuantity = req.body;
            const filter = { _id: ObjectId(id) };
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    availableQuantity: updatedQuantity.newStock,
                    minOrderQuantity: updatedQuantity.newMinOrder
                }
            }
            const result = await productsCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        })
        //load specific product details
        app.get('/product/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const product = await productsCollection.findOne(query);
            res.send(product);
        })
        //add orders to db
        app.post('/order', verifyJWT, async (req, res) => {
            const order = req.body;
            const result = await ordersCollection.insertOne(order);
            res.send(result);
        })
        //load specific order for payment
        app.get('/order/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const item = await ordersCollection.findOne(query);
            res.send(item);
        })
        //load orders according user
        app.get('/order', verifyJWT, async (req, res) => {
            const email = req.query.user;
            const query = { email: email }
            const order = await ordersCollection.find(query).toArray();
            res.send(order);
        })
        //load all the orders for admin management
        app.get('/orders', verifyJWT, verifyADMIN, async(req,res)=>{
            const query = {};
            const orders = await ordersCollection.find(query).toArray();
            res.send(orders);
        })
        //delete an specific order
        app.delete('/order/:id', verifyJWT, async(req,res)=>{
            const id =req.params.id;
            const query = {_id: ObjectId (id)}
            const result = (await ordersCollection.deleteOne(query));
            res.send(result);
        })
        //update order status by admin
        app.put('/order/:id', verifyJWT, verifyADMIN, async(req,res)=>{
            const id = req.params.id;
            const query = {_id: ObjectId (id)};
            const options = {upsert : true};
            const updatedDoc = {
                $set: {
                    orderStatus: 'Out for delivery'
                }
            }
            const result = await ordersCollection.updateOne(query, updatedDoc, options);
            res.send(result);
        })
        app.put
        //check user admin or not
        app.get('/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            res.send({ admin: isAdmin });
        })
    }
    finally {
        // await client.close()
    }
}
run().catch(console.dir);

//server test
app.get('/', (req, res) => {
    res.send('Hello from toolSea server World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})