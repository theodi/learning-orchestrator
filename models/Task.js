// Task model

export class Task {
  constructor(data = {}) {
    this.id = data.id;
    this.title = data.title;
    this.description = data.description;
    this.projectId = data.project_id || data.projectId;
    this.companyTaskId = data.company_task_id || data.companyTaskId;
    this.assigneeId = data.person_id || data.assigneeId;
    this.status = data.status;
    this.approved = data.approved;
    this.createdAt = data.created_at || data.createdAt;
    this.updatedAt = data.updated_at || data.updatedAt;
  }

  static fromForecastData(data) {
    return new Task({
      id: data.id,
      title: data.title,
      description: data.description,
      projectId: data.project_id,
      companyTaskId: data.company_task_id,
      assigneeId: data.person_id,
      status: data.status,
      approved: data.approved,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    });
  }

  static fromWebhookData(data, projectId) {
    return new Task({
      title: data.title,
      description: data.description,
      projectId: parseInt(projectId),
      approved: data.approved || true,
    });
  }

  toForecastFormat() {
    return {
      title: this.title,
      description: this.description,
      project_id: this.projectId,
      approved: this.approved,
    };
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      projectId: this.projectId,
      companyTaskId: this.companyTaskId,
      assigneeId: this.assigneeId,
      status: this.status,
      approved: this.approved,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  isValid() {
    return this.title && this.projectId;
  }
}

export default Task;
