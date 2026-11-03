import { Test, TestingModule } from '@nestjs/testing';
import { FallbackService } from './fallback.service.js';

describe('FallbackService', () => {
  let service: FallbackService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FallbackService],
    }).compile();

    service = module.get<FallbackService>(FallbackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
