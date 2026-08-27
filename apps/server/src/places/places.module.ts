import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

@Module({
  imports: [AssetsModule],
  controllers: [PlacesController],
  providers: [PlacesService],
})
export class PlacesModule {}
