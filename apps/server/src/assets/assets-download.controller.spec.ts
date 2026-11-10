import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthGuard } from '../auth/guards/auth.guard';
import { GrantsGuard } from '../auth/guards/grants.guard';
import { TokenService } from '../auth/token.service';
import { UsersService } from '../users/users.service';
import { JobQueueService } from '../jobs/job-queue.service';
import { AssetArchiveService } from './asset-archive.service';
import { AssetCaptionsService } from './asset-captions.service';
import { AssetMediaStreamer } from './asset-media-streamer';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { RotateService } from './rotate.service';

const ids = [
  'db9db85c-51d3-45ae-8dab-6cd88f5525d2',
  '32d2bc5f-ce11-4ccd-940c-05ebbacf1e73',
];

describe('POST assets/download.zip', () => {
  let app: INestApplication;
  const archive = {
    streamZip: jest.fn(async (res: { end: () => void }) => {
      res.end();
    }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AssetsController],
      providers: [
        { provide: AssetArchiveService, useValue: archive },
        ...[AssetsService, AssetMediaStreamer, JobQueueService, RotateService, AssetCaptionsService].map(
          (provide) => ({ provide, useValue: {} }),
        ),
        {
          provide: TokenService,
          useValue: { verifyAccessToken: async () => ({ userId: 'user', tokenVersion: 0 }) },
        },
        {
          provide: UsersService,
          useValue: {
            findById: async () => ({ id: 'user', permission: 'read', tokenVersion: 0 }),
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: GrantsGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  const url = '/api/v1/assets/download.zip';
  const post = () => request(app.getHttpServer()).post(url).set('Cookie', 'rc_access=test');

  it('requires a session', async () => {
    await request(app.getHttpServer()).post(url).send({ assetIds: ids }).expect(401);
    expect(archive.streamZip).not.toHaveBeenCalled();
  });

  it('streams a zip for a read-only user sending JSON', async () => {
    await post().send({ assetIds: ids }).expect(200);
    expect(archive.streamZip).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^recollect-photos-\d{4}-\d{2}-\d{2}$/),
      ids,
    );
  });

  it('accepts the comma-separated form post', async () => {
    await post().type('form').send({ assetIds: ids.join(',') }).expect(200);
    expect(archive.streamZip).toHaveBeenCalledWith(expect.anything(), expect.any(String), ids);
  });

  it('accepts the cap of 1000 ids in a form post', async () => {
    const many = Array.from({ length: 1000 }, () => ids[0]);
    await post().type('form').send({ assetIds: many.join(',') }).expect(200);
  });

  it('rejects empty, over-cap and malformed ids', async () => {
    await post().send({ assetIds: [] }).expect(400);
    await post().send({}).expect(400);
    await post().send({ assetIds: Array.from({ length: 1001 }, () => ids[0]) }).expect(400);
    await post().send({ assetIds: ['nope'] }).expect(400);
    expect(archive.streamZip).not.toHaveBeenCalled();
  });
});
