import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import dotenv from "dotenv";

//Imports of Routes
import authRoutes from './routes/auth.routes';
import profileRoutes from './routes/profile.routes';
import productRoutes from './routes/product.routes';
import cartRoutes from './routes/cart.routes';
import orderRoutes from './routes/order.routes';
import adminRoutes from './routes/admin.routes';
import fs from "fs";
/**
 * Express Application Configuration
 * This file initializes middleware, security settings, and global route handlers.
 */
dotenv.config();

const app = express();

app.set('trust proxy', 1);

/**
 * CORS(cross origin resource sharing) 
 * Allows your Frontend (e.g., Angular on port 4200) to securely communicate with this API.
 * 'credentials: true' is required to send and receive cookies/sessions. 
*/
app.use(cors({
    origin: process.env.FRONT_END_ORIGIN || 'http://localhost:4200',
    credentials: true
}));

/**
 * Body Parsing Middleware
 * express.json(): Parses incoming requests with JSON payloads.
 * urlencoded: Parses data from HTML forms.
 */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// This tells Express to indent JSON by 2 spaces default pretty-print format
app.set('json spaces', 2);

/**
 * Cookie Parser Middleware
 * Enables the server to read cookies sent from the client's browser for authentication.
 */
app.use(cookieParser());

/**
 * Static File Serving
 * Maps the physical 'ProductImages' folder to the '/Images' URL path.
 * Usage: http://localhost:3000/Images/product1.jpg
 */
app.use('/Images', express.static(path.join(__dirname, "..", "ProductImages")));

/**
 * Health Check Endpoint
 * Used by monitoring tools or load balancers to verify the server is running.
 */
app.get('/api/health', (req, res) => {
    res.json({ status: 'Ok', timeStamp: new Date().toISOString() });
})

/**
 * API Route Dispatcher
 * Each path follows a RESTful naming convention for predictable resource access.
 */
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/products", productRoutes);


app.use("/api/cart", cartRoutes);
app.use("/api/order", orderRoutes);
app.use("/api/admin", adminRoutes);

// Serve Angular build output from dist folder in production.
    const angularDistRoot = path.join(
      __dirname, "../../FRONT_END/frontend/dist/frontend",
    );
    const angularBrowserPath = path.join(angularDistRoot, "browser");
    const angularDistPath = fs.existsSync(angularBrowserPath)
      ? angularBrowserPath
      : angularDistRoot;
    app.use(express.static(angularDistPath));


    // SPA fallback for non-API routes.
    app.get(/^\/(?!api).*/, (req, res) => {
      res.sendFile(path.join(angularDistPath, "index.html"));
    });

// 404 Handler
app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

/**
 * Global Error Handling Middleware
 * Catch-all for any errors thrown in routes. 
 * Prevents the server from crashing and returns a clean JSON error to the client.
 */
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.message === 'Only image files are allowed (JPEG, PNG, WebP, GIF, https)') {
        return res.status(400).json({ error: err.message });
    }
console.error(err);
const status = err.status || 500;
    const message = process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message;
    res.status(status).json({ error: message });
})

export default app;

/**
 * Example of express.json
 * This is used for Modern Web Apps (React, Angular, Mobile Apps). The data is sent as a formatted JSON object.
    Sent with Header: Content-Type: application/json
        {
        "name": "Sahil",
        "email": "sahil@example.com"
        }
    app.post('/api/user', (req, res) => {
        // Because of express.json(), 'req.body' is now a clean JS object
        const userName = req.body.name; 
        console.log(userName); // Output: Sahil
        res.json({ message: "User received" });
    });

 *  Example of express.urlencoded({extended:true})
 *  This is used for Classic HTML Forms. When a user clicks a "Submit" button on a standard <form>, the browser sends the 
    data in a different format (like a URL string).
    Sent with Header: Content-Type: application/x-www-form-urlencoded
        name=Sahil&email=sahil%40example.com
    app.post('/submit-form', (req, res) => {
        // Because of urlencoded, this messy string is parsed into req.body
        console.log(req.body.name); // Output: Sahil
        res.send("Form processed");
    });
 *  Why "Extended: true"?
    You’ll notice { extended: true } inside the parentheses.
    false: Uses a basic library (querystring) that only understands simple strings.
    true: Uses a more powerful library (qs) that allows you to send nested objects or arrays through a form.
    ex.
        Simple
        user=Sahil&age=25
        Complex
        user[name]=Sahil&user[location]=Mumbai&tags[]=electronics&tags[]=sale
            {
                user: {
                    name: "Sahil",
                    location: "Mumbai"
                },
                tags: ["electronics", "sale"]
            }

 */
