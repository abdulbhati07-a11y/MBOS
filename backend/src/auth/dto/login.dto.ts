import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  /**
   * Disambiguates the tenant when the same address exists in more than one.
   * Section 5 makes email unique per tenant, not globally, and Section 6.3 does
   * not say how the tenant is resolved at login — see DEBT-014.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tenantSlug?: string;
}
