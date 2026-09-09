import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @ApiProperty({ format: 'password', writeOnly: true })
  password!: string;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'Short-lived access token' })
  accessToken!: string;
}
