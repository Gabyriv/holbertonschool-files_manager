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

  // GET /files/:id - return a single file document for the authenticated user
  static async getShow(req, res) {
    try {
      const token = req.headers['x-token'];
      if (!token) return res.status(401).json({ error: 'Unauthorized' });

      const userIdStr = await redisClient.get(`auth_${token}`);
      if (!userIdStr) return res.status(401).json({ error: 'Unauthorized' });

      const filesCol = dbClient.filesCollection || dbClient.db.collection('files');

      let fileId;
      try {
        fileId = new ObjectId(req.params.id);
      } catch (e) {
        // Invalid id - not found for this user
        return res.status(404).json({ error: 'Not found' });
      }

      const file = await filesCol.findOne({ _id: fileId, userId: new ObjectId(userIdStr) });
      if (!file) return res.status(404).json({ error: 'Not found' });

      return res.status(200).json({
        id: file._id.toString(),
        userId: file.userId.toString(),
        name: file.name,
        type: file.type,
        isPublic: Boolean(file.isPublic),
        parentId: file.parentId === 0 ? 0 : file.parentId.toString(),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // GET /files - list files for the authenticated user, by parentId and page
  static async getIndex(req, res) {
    try {
      const token = req.headers['x-token'];
      if (!token) return res.status(401).json({ error: 'Unauthorized' });

      const userIdStr = await redisClient.get(`auth_${token}`);
      if (!userIdStr) return res.status(401).json({ error: 'Unauthorized' });

      const filesCol = dbClient.filesCollection || dbClient.db.collection('files');

      const { parentId = '0', page = '0' } = req.query;
      const pageNum = Number.isNaN(parseInt(page, 10)) ? 0 : Math.max(0, parseInt(page, 10));
      const pageSize = 20;

      // Build match for parentId
      let parentMatch;
      if (!parentId || parentId === '0') {
        parentMatch = 0;
      } else {
        try {
          parentMatch = new ObjectId(parentId);
        } catch (e) {
          // Invalid parentId -> no results
          return res.status(200).json([]);
        }
      }

      const pipeline = [
        { $match: { userId: new ObjectId(userIdStr), parentId: parentMatch } },
        { $sort: { _id: 1 } },
        { $skip: pageNum * pageSize },
        { $limit: pageSize },
      ];

      const items = await filesCol.aggregate(pipeline).toArray();
      const result = items.map((file) => ({
        id: file._id.toString(),
        userId: file.userId.toString(),
        name: file.name,
        type: file.type,
        isPublic: Boolean(file.isPublic),
        parentId: file.parentId === 0 ? 0 : file.parentId.toString(),
      }));

      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // PUT /files/:id/publish - set isPublic = true for the owner's file
  static async putPublish(req, res) {
    try {
      const token = req.headers['x-token'];
      if (!token) return res.status(401).json({ error: 'Unauthorized' });

      const userIdStr = await redisClient.get(`auth_${token}`);
      if (!userIdStr) return res.status(401).json({ error: 'Unauthorized' });

      const filesCol = dbClient.filesCollection || dbClient.db.collection('files');

      let fileId;
      try {
        fileId = new ObjectId(req.params.id);
      } catch (e) {
        return res.status(404).json({ error: 'Not found' });
      }

      const ownerId = new ObjectId(userIdStr);
      const existing = await filesCol.findOne({ _id: fileId, userId: ownerId });
      if (!existing) return res.status(404).json({ error: 'Not found' });

      await filesCol.updateOne({ _id: fileId, userId: ownerId }, { $set: { isPublic: true } });
      const updated = await filesCol.findOne({ _id: fileId, userId: ownerId });

      return res.status(200).json({
        id: updated._id.toString(),
        userId: updated.userId.toString(),
        name: updated.name,
        type: updated.type,
        isPublic: Boolean(updated.isPublic),
        parentId: updated.parentId === 0 ? 0 : updated.parentId.toString(),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // PUT /files/:id/unpublish - set isPublic = false for the owner's file
  static async putUnpublish(req, res) {
    try {
      const token = req.headers['x-token'];
      if (!token) return res.status(401).json({ error: 'Unauthorized' });

      const userIdStr = await redisClient.get(`auth_${token}`);
      if (!userIdStr) return res.status(401).json({ error: 'Unauthorized' });

      const filesCol = dbClient.filesCollection || dbClient.db.collection('files');

      let fileId;
      try {
        fileId = new ObjectId(req.params.id);
      } catch (e) {
        return res.status(404).json({ error: 'Not found' });
      }

      const ownerId = new ObjectId(userIdStr);
      const existing = await filesCol.findOne({ _id: fileId, userId: ownerId });
      if (!existing) return res.status(404).json({ error: 'Not found' });

      await filesCol.updateOne({ _id: fileId, userId: ownerId }, { $set: { isPublic: false } });
      const updated = await filesCol.findOne({ _id: fileId, userId: ownerId });

      return res.status(200).json({
        id: updated._id.toString(),
        userId: updated.userId.toString(),
        name: updated.name,
        type: updated.type,
        isPublic: Boolean(updated.isPublic),
        parentId: updated.parentId === 0 ? 0 : updated.parentId.toString(),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Server error' });
    }
  }
}

export default FilesController;
