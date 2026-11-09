import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthGuard } from '../auth/guards/auth.guard';
import { GrantsGuard } from '../auth/guards/grants.guard';
import { TokenService } from '../auth/token.service';
import { UsersService } from '../users/users.service';
import { AssetMediaStreamer } from './asset-media-streamer';
import { AssetCaptionsService } from './asset-captions.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { JobQueueService } from '../jobs/job-queue.service';
import { RotateService } from './rotate.service';

const assetId = 'db9db85c-51d3-45ae-8dab-6cd88f5525d2';
const captionId = '32d2bc5f-ce11-4ccd-940c-05ebbacf1e73';
describe('authenticated caption routes', () => {
  let app: INestApplication;
  let permission = 'read';
  const service = {
    list: jest.fn(async () => []),
    create: jest.fn(async () => ({ id: captionId })),
    update: jest.fn(async () => ({ id: captionId })),
    delete: jest.fn(async () => {}),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AssetsController],
      providers: [
        { provide: AssetCaptionsService, useValue: service },
        ...[
          AssetsService,
          AssetMediaStreamer,
          JobQueueService,
          RotateService,
        ].map((provide) => ({ provide, useValue: {} })),
        {
          provide: TokenService,
          useValue: {
            verifyAccessToken: async () => ({
              userId: 'user',
              tokenVersion: 0,
            }),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findById: async () => ({ id: 'user', permission, tokenVersion: 0 }),
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: GrantsGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    permission = 'read';
    jest.clearAllMocks();
  });
  const path = `/api/v1/assets/${assetId}/captions`;
  it('requires a session for reads and every mutation', async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .post(path)
      .send({ text: 'caption' })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`${path}/${captionId}`)
      .send({ text: 'caption' })
      .expect(401);
    await request(app.getHttpServer())
      .delete(`${path}/${captionId}`)
      .expect(401);
    expect(service.list).not.toHaveBeenCalled();
    expect(service.create).not.toHaveBeenCalled();
  });
  it('allows readers to read but denies all entry mutations', async () => {
    await request(app.getHttpServer())
      .get(path)
      .set('Cookie', 'rc_access=test')
      .expect(200, { captions: [] });
    await request(app.getHttpServer())
      .post(path)
      .set('Cookie', 'rc_access=test')
      .send({ text: 'caption' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`${path}/${captionId}`)
      .set('Cookie', 'rc_access=test')
      .send({ text: 'caption' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`${path}/${captionId}`)
      .set('Cookie', 'rc_access=test')
      .expect(403);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.delete).not.toHaveBeenCalled();
  });
  it.each(['write', 'delete'])(
    'allows %s grants and preserves omitted versus null attribution',
    async (grant) => {
      permission = grant;
      await request(app.getHttpServer())
        .post(path)
        .set('Cookie', 'rc_access=test')
        .send({ text: ' trimmed ' })
        .expect(201);
      expect(service.create).toHaveBeenCalledWith(
        assetId,
        expect.objectContaining({ text: 'trimmed' }),
      );
      await request(app.getHttpServer())
        .patch(`${path}/${captionId}`)
        .set('Cookie', 'rc_access=test')
        .send({ text: 'edited' })
        .expect(200);
      expect(service.update.mock.calls[0][2].saidByPersonId).toBeUndefined();
      await request(app.getHttpServer())
        .patch(`${path}/${captionId}`)
        .set('Cookie', 'rc_access=test')
        .send({ text: 'edited', saidByPersonId: null })
        .expect(200);
      expect(service.update.mock.calls[1][2].saidByPersonId).toBeNull();
      await request(app.getHttpServer())
        .delete(`${path}/${captionId}`)
        .set('Cookie', 'rc_access=test')
        .expect(204);
      expect(service.delete).toHaveBeenCalledWith(assetId, captionId);
    },
  );
  it('validates identifiers, text and explicit person references before calling persistence', async () => {
    permission = 'write';
    for (const body of [
      { text: ' ' },
      { text: 'x'.repeat(501) },
      { text: 42 },
      { text: 'ok', saidByPersonId: 'typed name' },
    ]) {
      await request(app.getHttpServer())
        .post(path)
        .set('Cookie', 'rc_access=test')
        .send(body)
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/api/v1/assets/no/captions')
      .set('Cookie', 'rc_access=test')
      .send({ text: 'ok' })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post(path)
      .set('Cookie', 'rc_access=test')
      .send({ text: '🌻'.repeat(500), saidByPersonId: captionId })
      .expect(201);
  });
});
