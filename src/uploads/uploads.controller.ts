import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiFoundResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateUploadDto } from './uploads.dto';
import { UploadsService } from './uploads.service';

@ApiTags('uploads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateUploadDto) {
    return this.uploads.createUpload(user.id, dto);
  }

  @Post(':id/complete')
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.uploads.complete(user.id, id);
  }

  @Get(':id/content')
  @Redirect(undefined, 302)
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @ApiFoundResponse({ description: 'Redirects to a fresh private signed download URL' })
  async getContent(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return { url: await this.uploads.getContentUrl(user.id, id), statusCode: 302 };
  }

  @Get(':id')
  getDownload(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.uploads.getDownload(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.uploads.remove(user.id, id);
  }
}
