import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    archiveWorkspace as archiveWorkspaceRecord,
    createWorkspace as createWorkspaceRecord,
    deleteWorkspace as deleteWorkspaceRecord,
    getWorkspace as getWorkspaceRecord,
    listArchivedWorkspaces as listArchivedWorkspaceRecords,
    listWorkspaces as listWorkspaceRecords,
    restoreWorkspace as restoreWorkspaceRecord,
    updateWorkspace as updateWorkspaceRecord
} from "../infrastructure/persistence/state/projects-store.js";
import {
    appendMessage as appendSessionMessage,
    createSession as createChatSession,
    deleteSession as deleteChatSession,
    getMessages as getSessionMessages,
    getSession as getChatSession,
    listSessions as listChatSessions,
    setActiveSelection,
    updateSession as updateChatSession
} from "../infrastructure/persistence/state/chats-store.js";
import {
    appendTaskStep as appendTaskStepRecord,
    completeTask as completeTaskRecord,
    createTask as createTaskRecord,
    getLatestTask as getLatestTaskRecord,
    getTask as getTaskRecord,
    updateTask as updateTaskRecord
} from "../infrastructure/persistence/state/tasks-store.js";
import {
    getSessionContext as getStoredSessionContext,
    getWorkspaceContext as getStoredWorkspaceContext,
    updateProjectMemory as updateStoredProjectMemory
} from "../infrastructure/persistence/state/context-store.js";
import { loadStateSnapshot } from "../infrastructure/persistence/state/state-bootstrap.js";

export class StateStore {
    constructor(repoRoot, config) {
        this.path = join(config.runtime.dataRoot, "state.json");
        this.config = config;
        mkdirSync(config.runtime.dataRoot, { recursive: true });
        this.state = this.load();
    }

    load() {
        return loadStateSnapshot(this.path, this.config);
    }

    save() {
        writeFileSync(this.path, JSON.stringify(this.state, null, 2), "utf-8");
    }

    snapshot() {
        return structuredClone(this.state);
    }

    getWorkspace(workspaceId) {
        return getWorkspaceRecord(this, workspaceId);
    }

    listWorkspaces() {
        return listWorkspaceRecords(this);
    }

    listArchivedWorkspaces() {
        return listArchivedWorkspaceRecords(this);
    }

    listSessions(workspaceId) {
        return listChatSessions(this, workspaceId);
    }

    getSession(sessionId) {
        return getChatSession(this, sessionId);
    }

    getMessages(sessionId) {
        return getSessionMessages(this, sessionId);
    }

    getSessionContext(sessionId) {
        return getStoredSessionContext(this, sessionId);
    }

    async updateProjectMemory(workspaceId, fact) {
        return updateStoredProjectMemory(this, workspaceId, fact);
    }

    getWorkspaceContext(workspaceId, excludeSessionId = null) {
        return getStoredWorkspaceContext(this, workspaceId, excludeSessionId);
    }

    getLatestTask(sessionId) {
        return getLatestTaskRecord(this, sessionId);
    }

    getTask(taskId) {
        return getTaskRecord(this, taskId);
    }

    createWorkspace({ name, path, icon }) {
        return createWorkspaceRecord(this, { name, path, icon });
    }

    updateWorkspace(workspaceId, patch) {
        return updateWorkspaceRecord(this, workspaceId, patch);
    }

    archiveWorkspace(workspaceId) {
        return archiveWorkspaceRecord(this, workspaceId);
    }

    restoreWorkspace(workspaceId) {
        return restoreWorkspaceRecord(this, workspaceId);
    }

    deleteWorkspace(workspaceId) {
        return deleteWorkspaceRecord(this, workspaceId);
    }

    createSession(workspaceId, title = "New chat") {
        return createChatSession(this, workspaceId, title);
    }

    updateSession(sessionId, patch) {
        return updateChatSession(this, sessionId, patch);
    }

    deleteSession(sessionId) {
        return deleteChatSession(this, sessionId);
    }

    appendMessage(sessionId, role, text, meta = {}) {
        return appendSessionMessage(this, sessionId, role, text, meta);
    }

    createTask(sessionId, prompt, meta = {}) {
        return createTaskRecord(this, sessionId, prompt, meta);
    }

    updateTask(taskId, patch) {
        return updateTaskRecord(this, taskId, patch);
    }

    appendTaskStep(taskId, step) {
        return appendTaskStepRecord(this, taskId, step);
    }

    completeTask(taskId, patch) {
        return completeTaskRecord(this, taskId, patch);
    }

    setActive(workspaceId, sessionId) {
        return setActiveSelection(this, workspaceId, sessionId);
    }
}
