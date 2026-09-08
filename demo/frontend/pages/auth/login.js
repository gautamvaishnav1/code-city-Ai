/**
 * @name Hotel Room Booking System
 * @author Md. Samiur Rahman (Mukul)
 * @description Hotel Room Booking and Management System Software ~ Developed By Md. Samiur Rahman (Mukul)
 * @copyright ©2023 ― Md. Samiur Rahman (Mukul). All rights reserved.
 * @version v0.0.1
 *
 */

import { LockOutlined, MailOutlined } from '@ant-design/icons';
import {
  Button, Checkbox, Form, Input
} from 'antd';
import Link from 'next/link';
import React, { useState } from 'react';
import MainLayout from '../../components/layout';
import PublicRoute from '../../components/routes/PublicRoute';
import ApiService from '../../utils/apiService';
import { setSessionUserAndToken } from '../../utils/authentication';
import notificationWithIcon from '../../utils/notification';

function Login() {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const onFinish = (values) => {
    ApiService.post('/api/v1/auth/login', values)
      .then((response) => {
        setLoading(false);
        if (response?.result_code === 0) {
          setSessionUserAndToken(response?.result?.data, response?.access_token, response?.refresh_token);
          form.resetFields();
          window.location.href = '/profile?tab=my-profile';
        } else {
          notificationWithIcon('error', 'ERROR', 'Sorry! Something went wrong. App server error');
        }
      })
      .catch((err) => {
        setLoading(false);
        notificationWithIcon('error', 'ERROR', err?.response?.data?.result?.error?.message || err?.response?.data?.result?.error || 'Sorry! Something went wrong. App server error');
      });
  };

  return (
    <PublicRoute>
      <MainLayout title='Beach Resort ― Login'>
        <div style={{ width: '400px', height: 'calc(100vh - 205px)', margin: '0 auto' }}>
          <Form
            form={form}
            className='login-form'
            style={{ paddingTop: '160px' }}
            initialValues={{ remember: true }}
            name='beach-resort-login-form'
            onFinish={onFinish}
          >
            <Form.Item
              name='email'
              rules={[{
                required: true,
                message: 'Please input your Email!'
              }]}
            >
              <Input
                prefix={<MailOutlined className='site-form-item-icon' />}
                placeholder='Email'
                size='large'
              />
            </Form.Item>

            <Form.Item
              name='password'
              rules={[{
                required: true,
                message: 'Please input your Password!'
              }]}
            >
              <Input.Password
                prefix={<LockOutlined className='site-form-item-icon' />}
                placeholder='Password'
                type='password'
                size='large'
              />
            </Form.Item>

            <Form.Item>
              <Form.Item
                valuePropName='checked'
                name='remember'
                noStyle
              >
                <Checkbox>Remember me</Checkbox>
              </Form.Item>

              <Link
                className='btn-forgot-password'
                href='/auth/forgot-password'
              >
                Forgot Password
              </Link>
            </Form.Item>

            <Form.Item>
              <Button
                className='login-form-button'
                htmlType='submit'
                type='primary'
                size='large'
                block
                loading={loading}
                disabled={loading}
              >
                Log In
              </Button>
            </Form.Item>

            <Link
              className='btn-login-registration'
              href='/auth/registration'
            >
              Or Registration Here!
            </Link>

            {/* Social login div */}
            <div style={{ paddingTop: '16px', borderTop: '1px solid #e0e0e0', marginTop: '16px' }}>
              <Button type='link' onClick={() => window.location.href='/api/v1/auth/google'}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M22.16 11.53a9.96 9.96 0 0 1-2.94.92c.03-.91.05-1.83.05-2.75 0-1.27-.16-2.46-.47-3.63-.36.19-1.03.25-2.08.23-.11.01-.22.01-.33.01-.96 0-1.78-.02-2.56-.1-1.23-.07-2.36-.13-3.44-.14-.08-.07-.16-.07-.25-.07-.15 0-.29.01-.42.02s-.27.03-.42.05c-.66.1-1.22.32-1.68.63-.08.05-.16.1-.22.12s-.15.08-.22.12c-.41.23-.73.57-1.02.98-.06.07-.12.13-.18.2s-.06.06-.08.1zM7.33 17.05a5.97 5.97 0 0 1-1.08-.13 5.99 5.99 0 0 1-1.08.13 6.07 6.07 0 0 0-1.81 1.21 3.06 3.06 0 0 0-.6 2.23.98.98 0 0 0 .6 2.16 5.91 5.91 0 0 1 1.81.13 6.05 6.05 0 0 1 1.81-.13 3.05 3.05 0 0 0 .6-2.16 3.07 3.07 0 0 0-.6-2.23c-.01-.66-.02-1.35-.02-2.04 0-2.96 2.18-3.7 5.38-3.7 1.39 0 2.64.45 3.67 1.3 1.03-.97 2.09-1.5 3.56-1.51 9.12.01 9.64-.01 9.65-.01-1.16-.17-2.2-.44-3.15-.66-.2-.11-.2-.16-.2-.2s-.05-.05-.08-.08c-.66-.2-1.26-.4-1.78-.75zM12 5.37a4.63 4.63 0 1 0 0 9.26 4.63 4.63 0 0 0 0-9.26zM12 2.71a9.98 9.98 0 1 1 0 19.96 9.98 9.98 0 0 1 0-19.96z" />
                </svg> Continue with Google
              </Button>
              <Button type='link' style={{ marginLeft: '16px' }} onClick={() => window.location.href='/api/v1/auth/github'}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577a7.951 7.951 0 0 0-1.814-1.04 3.068 3.068 0 0 0-2.607.768 7.938 7.938 0 0 0-2.307-2.288l-.563-.563a5.994 5.994 0 0 0-3.47 2.547 5.939 5.939 0 0 0 2.305 3.096 5.996 5.996 0 0 0 3.468-2.547l.563.563c2.194-.257 3.527-1.035 3.527-2.31 0-1.273-.738-2.223-1.987-2.405-.98-.096-1.96-.4-2.73-.88a5.954 5.954 0 0 0-.788-2.657 5.998 5.998 0 0 0-2.547-2.155l-.532-.532a7.972 7.972 0 0 0-2.288-3.47 7.926 7.926 0 0 0-2.288 3.47l.532.532c-.778 1.63-.98 3.66-.98 5.907 0 3.309 1.68 6.033 3.878 6.908 1.522.578 1.087.96 1.75.96s.899-.11.899-.5v.053c0 2.014.87 3.93 2.292 4.304 1.422.365 2.877.53 4.377.53 2.22 0 3.627-.504 4.6-1.5 1.1-.127 1.88-.4 2.31-.836a7.989 7.989 0 0 0 2.74-2.255 5.996 5.996 0 0 0-1.048-3.961 5.998 5.998 0 0 0-3.668-1.997l-.528-.528z" />
                </svg> Continue with GitHub
              </Button>
            </div>
          </Form>
        </div>
      </MainLayout>
    </PublicRoute>
  );
}

export default Login;
