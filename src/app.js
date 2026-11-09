import cors from 'cors';
import express from 'express';
import { pool } from './config/database.js';
import { createAttachmentsRouter } from './routes/attachments/attachments.js';
import { createChecklistRouter } from './routes/checklist/checklist.js';
import { createCommentsRouter } from './routes/comments/comments.js';
import healthRouter from './routes/health.js';
import { createLabelsRouter } from './routes/labels/labels.js';
import { createMembersRouter } from './routes/members/members.js';
import { createNotificationsRouter } from './routes/notifications/notifications.js';
import { createProjectsRouter } from './routes/projects/projects.js';
import { createSubtasksRouter } from './routes/subtasks/subtasks.js';
import { createTasksRouter } from './routes/tasks/tasks.js';

const app = express();

const allowedOrigin = process.env.CORS_ORIGIN;

app.use(cors({
	origin: (requestOrigin, callback) => {
		callback(null, Boolean(allowedOrigin && requestOrigin === allowedOrigin));
	},
}));
app.use(express.json());
app.use('/api/health', healthRouter);
app.use('/api/projects', createProjectsRouter(pool));
app.use('/api/projects/:projectId/labels', createLabelsRouter(pool));
app.use('/api/projects/:projectId/members', createMembersRouter(pool));
app.use('/api/projects/:projectId/notifications', createNotificationsRouter(pool));
app.use('/api/projects/:projectId/tasks', createTasksRouter(pool));
app.use('/api/projects/:projectId/tasks/:taskId/comments', createCommentsRouter(pool));
app.use('/api/projects/:projectId/tasks/:taskId/checklist', createChecklistRouter(pool));
app.use('/api/projects/:projectId/tasks/:taskId/attachments', createAttachmentsRouter(pool));
app.use('/api/projects/:projectId/tasks/:taskId/subtasks', createSubtasksRouter(pool));

export default app;