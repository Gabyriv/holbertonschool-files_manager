import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import path from 'path';
import { ObjectId } from 'mongodb';
import redisClient from '../utils/redis';
import dbClient from '../utils/db';

class FilesController {
  // POST /files
  static async postUpload(req, res) {
    try {
      // Auth
      const token = req.headers['x-token'];
      if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const userIdStr = await redisClient.get(`auth_${token}`);
      if (!userIdStr) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const usersCol = dbClient.usersCollection || dbClient.db.collection('users');
      const filesCol = dbClient.filesCollection || dbClient.db.collection('files');

      const user = await usersCol.findOne({ _id: new ObjectId(userIdStr) });
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Body
      const {
        name,
        type,
        parentId = 0,
        isPublic = false,
        data,
      } = req.body || {};

      if (!name) {
        return res.status(400).json({ error: 'Missing name' });
      }

      const allowedTypes = ['folder', 'file', 'image'];
      if (!type || !allowedTypes.includes(type)) {
        return res.status(400).json({ error: 'Missing type' });
      }

      if (type !== 'folder' && !data) {
        return res.status(400).json({ error: 'Missing data' });
      }

      let parent = null;
      let parentIdToStore = 0;
      if (parentId && parentId !== 0) {
        try {
          parent = await filesCol.findOne({ _id: new ObjectId(parentId) });
        } catch (e) {
          // invalid ObjectId
          parent = null;
        }
        if (!parent) {
          return res.status(400).json({ error: 'Parent not found' });
        }
        if (parent.type !== 'folder') {
          return res.status(400).json({ error: 'Parent is not a folder' });
        }
        parentIdToStore = parent._id; // as ObjectId
      }

      // Prepare doc
      const doc = {
        userId: user._id,
        name,
        type,
        isPublic: Boolean(isPublic),
        parentId: parentIdToStore,
      };

      if (type === 'folder') {
        const result = await filesCol.insertOne(doc);
        return res.status(201).json({
          id: result.insertedId.toString(),
          userId: user._id.toString(),
          name,
          type,
          isPublic: Boolean(isPublic),
          parentId: parentIdToStore === 0 ? 0 : parentIdToStore.toString(),
        });
      }

      // Files and images: write to disk
      const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
      await fs.mkdir(folderPath, { recursive: true });

      const localPath = path.join(folderPath, uuidv4());
      const fileData = Buffer.from(data, 'base64');
      await fs.writeFile(localPath, fileData);

      doc.localPath = localPath;
      const result = await filesCol.insertOne(doc);
      return res.status(201).json({
        id: result.insertedId.toString(),
        userId: user._id.toString(),
        name,
        type,
        isPublic: Boolean(isPublic),
        parentId: parentIdToStore === 0 ? 0 : parentIdToStore.toString(),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  }
}

export default FilesController;
