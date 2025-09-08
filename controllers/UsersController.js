import sha1 from 'sha1';
import { ObjectId } from 'mongodb';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

class UsersController {
  // POST /users
  static async postNew(req, res) {
    const { email, password } = req.body || {};

    // Validate input
    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Missing password' });
    }

    try {
      // Check if user already exists
      const existing = await dbClient.usersCollection.findOne({ email });
      if (existing) {
        return res.status(400).json({ error: 'Already exist' });
      }

      // Hash password using SHA1 and insert
      const hashedPassword = sha1(password);
      const result = await dbClient.usersCollection.insertOne({
        email,
        password: hashedPassword,
      });

      return res.status(201).json({ id: result.insertedId.toString(), email });
    } catch (err) {
      // Basic server error handling
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // GET /users/me
  static async getMe(req, res) {
    try {
      const token = req.headers['x-token'];
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const userId = await redisClient.get(`auth_${token}`);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const usersCol = dbClient.usersCollection || dbClient.db.collection('users');
      const user = await usersCol.findOne({ _id: new ObjectId(userId) });
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      return res.status(200).json({ id: user._id.toString(), email: user.email });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  }
}

export default UsersController;
