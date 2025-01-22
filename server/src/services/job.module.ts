import { Module } from '@nestjs/common';
import { KnexModule } from 'nestjs-knex';
import { JobService } from './job.service';

@Module({
  imports: [
    KnexModule.forRootAsync({
      useFactory: () => ({
        config: {
          client: 'pg',
          connection: process.env.DATABASE_URL,
          pool: { min: 2, max: 10 }
        }
      })
    })
  ],
  providers: [
    {
      provide: JobService,
      useClass: JobService
    }
  ],
  exports: [JobService]
})
export class JobModule {}