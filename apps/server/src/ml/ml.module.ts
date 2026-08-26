import { Global, Module } from '@nestjs/common';
import { MlClientService } from './ml-client.service';

@Global()
@Module({
  providers: [MlClientService],
  exports: [MlClientService],
})
export class MlModule {}
