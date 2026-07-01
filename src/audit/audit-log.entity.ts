import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  entityName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  entityId!: string | null;

  @Column({ type: 'varchar', length: 50 })
  action!: string; // 'INSERT', 'UPDATE', 'DELETE'

  @Column({ type: 'jsonb', nullable: true })
  oldValues!: any;

  @Column({ type: 'jsonb', nullable: true })
  newValues!: any;

  @Column({ type: 'int', nullable: true })
  userId!: number | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
