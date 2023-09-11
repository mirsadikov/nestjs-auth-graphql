import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon from 'argon2';
import { PrismaService } from 'src/prisma/prisma.service';
import { SignUpInput } from './dto/signup-input';
import { SignInInput } from './dto/signin-input';
import { SignResponse } from './dto/sign-response';
import { LogoutResponse } from './dto/logout-response';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async signUp(signUpInput: SignUpInput): Promise<SignResponse> {
    const userWithSameEmail = await this.prisma.user.findUnique({
      where: { email: signUpInput.email },
    });

    if (userWithSameEmail) {
      throw new ForbiddenException('User with this email already exists');
    }

    const user = await this.prisma.user.create({
      data: {
        username: signUpInput.username,
        hashedPassword: await argon.hash(signUpInput.password),
        email: signUpInput.email,
      },
    });

    const { accessToken, refreshToken } = await this.createTokens(
      user.id,
      user.email,
    );

    await this.updateRefreshToken(user.id, refreshToken);
    return { accessToken, refreshToken, user };
  }

  async signIn(signInInput: SignInInput): Promise<SignResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: signInInput.email },
    });

    if (!user) {
      throw new ForbiddenException('User with this email does not exist');
    }

    const doPasswordsMatch = await argon.verify(
      user.hashedPassword,
      signInInput.password,
    );

    if (!doPasswordsMatch) {
      throw new ForbiddenException('Password is incorrect');
    }

    const { accessToken, refreshToken } = await this.createTokens(
      user.id,
      user.email,
    );

    await this.updateRefreshToken(user.id, refreshToken);
    return { accessToken, refreshToken, user };
  }

  async logout(userId: number): Promise<LogoutResponse> {
    await this.prisma.user.updateMany({
      where: { id: userId, hashedRefreshToken: { not: null } },
      data: { hashedRefreshToken: null },
    });

    return { loggedOut: true };
  }

  async createTokens(userId: number, email: string) {
    const accessToken = this.jwtService.sign(
      { userId, email },
      {
        expiresIn: '1h',
        secret: this.configService.get('ACCESS_TOKEN_SECRET'),
      },
    );
    const refreshToken = this.jwtService.sign(
      {
        userId,
        email,
        accessToken,
      },
      {
        expiresIn: '7d',
        secret: this.configService.get('REFRESH_TOKEN_SECRET'),
      },
    );
    return { accessToken, refreshToken };
  }

  async updateRefreshToken(userId: number, refreshToken: string) {
    const hashedRefreshToken = await argon.hash(refreshToken);
    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedRefreshToken },
    });
  }
}
