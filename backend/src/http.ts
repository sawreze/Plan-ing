import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { z } from 'zod';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new BadRequestException({ message: '입력값을 확인해주세요', issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  return r.data;
}

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const uuid = z.uuid();

// pg 오류를 사용자 응답으로 바꾸고, 나머지 예상 못한 오류는 내용 없이 500으로 숨긴다.
const pgMap: Record<string, [number, string]> = {
  '23P01': [409, '시간이 겹치는 계획이 있어요. 다른 시간으로 정해주세요. 색깔은 같아도 괜찮아요.'],
  '23514': [400, '입력값을 확인해주세요'],
  '22008': [400, '날짜를 확인해주세요'],
  '22007': [400, '날짜를 확인해주세요'],
  '22P02': [404, '찾을 수 없어요'],
};

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (e instanceof HttpException) {
      const body = e.getResponse();
      return res.status(e.getStatus()).json(typeof body === 'string' ? { message: body } : body);
    }
    const hit = pgMap[e?.code];
    if (hit) return res.status(hit[0]).json({ message: hit[1] });
    console.error(e);
    res.status(500).json({ message: '잠시 후 다시 시도해주세요' });
  }
}
