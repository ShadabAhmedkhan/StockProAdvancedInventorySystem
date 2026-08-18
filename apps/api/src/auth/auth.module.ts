import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { jwtConfig } from '../config/jwt.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';

/**
 * JwtModule is registered without a global secret: every sign and verify call
 * passes the secret it needs, so an access token can never be produced or
 * accepted with the refresh key by omission.
 */
@Module({
  imports: [ConfigModule.forFeature(jwtConfig), JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenService],
  // JwtModule is re-exported because the global JwtAuthGuard is declared in
  // AppModule and resolves its dependencies from there.
  exports: [AuthService, RefreshTokenService, JwtModule],
})
export class AuthModule {}
