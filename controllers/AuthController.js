import { v4 as uuidv4 } from 'uuid';
import sha1 from 'sha1';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

class AuthController {
  // GET /connect
  static async getConnect(req, res) {
    try {
      const auth = req.headers.authorization || '';
      // Expecting format: "Basic base64(email:password)"
      if (!auth.startsWith('Basic ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const base64 = auth.slice('Basic '.length);
      let decoded;
      try {
        decoded = Buffer.from(base64, 'base64').toString('utf-8');
      } catch (e) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const sepIndex = decoded.indexOf(':');
      if (sepIndex === -1) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const email = decoded.slice(0, sepIndex);
      const password = decoded.slice(sepIndex + 1);

      const hashedPassword = sha1(password);
      const usersCol = dbClient.usersCollection || dbClient.db.collection('users');
      const user = await usersCol.findOne({ email, password: hashedPassword });
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const token = uuidv4();
      const key = `auth_${token}`;
      // 24 hours in seconds
      const ttl = 24 * 60 * 60;
      await redisClient.set(key, user._id.toString(), ttl);
      return res.status(200).json({ token });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // GET /disconnect
  static async getDisconnect(req, res) {
    try {
      const token = req.headers['x-token'];
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const key = `auth_${token}`;
      const userId = await redisClient.get(key);
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      await redisClient.del(key);
      return res.status(204).send();
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  }
}

export default AuthController;
