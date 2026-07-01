import {
  EventSubscriber,
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
  RemoveEvent,
} from 'typeorm';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AuditLog } from './audit-log.entity';

@EventSubscriber()
@Injectable()
export class AuditSubscriber implements EntitySubscriberInterface {
  constructor(private readonly cls: ClsService) {}

  listenTo() {
    return 'all'; // Listen to all entities
  }

  // Prevent infinite loops by ignoring the AuditLog entity itself
  private shouldAudit(entity: any): boolean {
    if (!entity) return false;
    const name = entity.constructor?.name;
    // Add any other entities to ignore here
    return name && name !== 'AuditLog';
  }

  private getUserId(): number | null {
    try {
      if (this.cls.isActive()) {
        const userId = this.cls.get('userId');
        return userId ? Number(userId) : null;
      }
    } catch {
      // Ignore CLS errors if running outside of request context (e.g., migrations, seeder)
    }
    return null;
  }

  async afterInsert(event: InsertEvent<any>) {
    if (!this.shouldAudit(event.entity)) return;

    const audit = new AuditLog();
    audit.action = 'INSERT';
    audit.entityName = event.metadata.name;
    audit.entityId = this.getEntityId(event.entity, event.metadata);
    audit.newValues = event.entity;
    audit.userId = this.getUserId();

    // Use event.manager to save within the same transaction context if one exists
    await event.manager.save(AuditLog, audit);
  }

  async afterUpdate(event: UpdateEvent<any>) {
    if (!this.shouldAudit(event.entity)) return;

    const audit = new AuditLog();
    audit.action = 'UPDATE';
    audit.entityName = event.metadata.name;
    audit.entityId = this.getEntityId(event.entity, event.metadata) || this.getEntityId(event.databaseEntity, event.metadata);
    
    // Determine what changed
    const changedFields: Record<string, any> = {};
    if (event.updatedColumns.length > 0) {
      for (const column of event.updatedColumns) {
        const propertyName = column.propertyName;
        if (event.entity) {
          changedFields[propertyName] = (event.entity as any)[propertyName];
        }
      }
      audit.newValues = changedFields;
    } else {
      audit.newValues = event.entity;
    }
    
    audit.oldValues = event.databaseEntity;
    audit.userId = this.getUserId();

    await event.manager.save(AuditLog, audit);
  }

  async afterRemove(event: RemoveEvent<any>) {
    if (!event.databaseEntity && !event.entity) return;
    if (!this.shouldAudit(event.entity || event.databaseEntity)) return;

    const audit = new AuditLog();
    audit.action = 'DELETE';
    audit.entityName = event.metadata.name;
    audit.entityId = this.getEntityId(event.entity || event.databaseEntity, event.metadata);
    audit.oldValues = event.databaseEntity || event.entity;
    audit.userId = this.getUserId();

    await event.manager.save(AuditLog, audit);
  }

  private getEntityId(entity: any, metadata: any): string | null {
    if (!entity || !metadata) return null;
    
    // If there is only one primary column, return it directly
    if (metadata.primaryColumns.length === 1) {
      const propName = metadata.primaryColumns[0].propertyName;
      return entity[propName] ? String(entity[propName]) : null;
    }

    // For composite keys, combine them
    if (metadata.primaryColumns.length > 1) {
      const keys = metadata.primaryColumns.map((col: any) => entity[col.propertyName]);
      return keys.join('-');
    }

    // Fallback if we can't determine it
    return entity.id ? String(entity.id) : null;
  }
}
