import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PrismaService, useValue: { $queryRaw: jest.fn() } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('liveness', () => {
    it('answers without touching the database', () => {
      expect(appController.getHello()).toContain('MBOS API');
    });
  });

  describe('readiness', () => {
    it('reports ok when the database answers', async () => {
      const prisma = appController['appService']['prisma'];
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);

      await expect(appController.getReadiness()).resolves.toEqual({
        status: 'ok',
        db: 'up',
      });
    });

    it('throws 503 when the database is unreachable', async () => {
      const prisma = appController['appService']['prisma'];
      (prisma.$queryRaw as jest.Mock).mockRejectedValue(
        new Error('connection refused'),
      );

      await expect(appController.getReadiness()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
