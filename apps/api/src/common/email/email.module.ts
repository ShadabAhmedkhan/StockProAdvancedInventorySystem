import { Module } from '@nestjs/common';
import { ConsoleEmailProvider, EMAIL_PROVIDER, EmailService } from './email.service';

@Module({
  providers: [ConsoleEmailProvider, { provide: EMAIL_PROVIDER, useExisting: ConsoleEmailProvider }, EmailService],
  exports: [EmailService],
})
export class EmailModule {}
