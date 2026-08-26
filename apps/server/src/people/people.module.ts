import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { MlModule } from '../ml/ml.module';
import { FaceCropService } from './face-crop.service';
import { DetectFacesHandler } from './handlers/detect-faces.handler';
import { EmbedClipHandler } from './handlers/embed-clip.handler';
import { MlProcessingService } from './ml-processing.service';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';

@Module({
  imports: [MediaModule, MlModule],
  controllers: [PeopleController],
  providers: [
    FaceCropService,
    MlProcessingService,
    PeopleService,
    DetectFacesHandler,
    EmbedClipHandler,
  ],
})
export class PeopleModule {}
