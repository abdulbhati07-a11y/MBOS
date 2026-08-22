import { IsString, Length, Matches } from 'class-validator';

export class MfaVerifyDto {
  @IsString()
  mfaSessionToken!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'code must be six digits' })
  code!: string;
}
