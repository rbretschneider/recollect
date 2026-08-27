import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { RequireAdmin } from '../auth/decorators/require-admin.decorator';
import { DevicesService, DeviceSummary } from './devices.service';
import { SetDeviceOwnerRequestDto } from './dto/set-device-owner-request.dto';

/** Cameras seen in the library, mappable to the people who own them. */
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @RequireAdmin()
  @Get()
  async list(): Promise<{ devices: DeviceSummary[] }> {
    return { devices: await this.devices.list() };
  }

  @RequireAdmin()
  @Put('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setOwner(@Body() body: SetDeviceOwnerRequestDto): Promise<void> {
    await this.devices.setOwner(body.cameraMake, body.cameraModel, body.personId ?? null);
  }
}
