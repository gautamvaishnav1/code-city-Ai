import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { User, UserDocument } from './Schema/user.schema.js'
import mongoose, { Model } from 'mongoose'
import { userRegister } from './types/user-register.types.js'
import { userUpdate } from './types/user-update.js'

@Injectable()
export class UserService {
  constructor (@InjectModel(User.name) private userModel: Model<User>) {}

  /**
   *
   * @param email check for email exists or not
   * @returns
   */
  async findByEmail (email: string) {
    const user = await this.userModel.findOne({ email }).exec()
    console.log(user, 'user found')
    return user
  }

  /**
   *
   * @param email find for login with password
   * @returns
   */
  async findByEmailWithPassword (email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).select('+password').exec()
  }

  /**
   * @param providerId find by github provide id
   * @returns
   */
  async findByGithubProviderId (
    providerId: string,
  ): Promise<UserDocument | null> {
    return this.userModel.findOne({ providerId }).exec()
  }

  async registerUser (user: userRegister) {
    try {
      const res = await this.userModel.create({
        name: user.name,
        email: user.email,
        password: user.password,
        profileImage: user.profileImage,
        provider: user.provider ?? 'local',
        providerId: user.providerId,
        GitHubAccessToken: user.githubAccessToken,
      })
      return [res.name, res.email, res._id]
    } catch (error: any) {
      if (error.code === 11000) {
        throw new ConflictException('email already exists')
      }
      throw new InternalServerErrorException('internal server Error')
    }
  }


/**
 * 
 * @param userId update user id through this
 * @param updateData in update data we pass data using this
 * @returns update data in DB
 */  
  async updateUser (userId:mongoose.Types.ObjectId, updateData: userUpdate) {
    try {
      const res = await this.userModel.findByIdAndUpdate(
        userId,
        { $set: updateData },
        { new: true },
      )
      return res
    } catch (error) {
      throw new InternalServerErrorException('Internal server')
    }
  }
}
