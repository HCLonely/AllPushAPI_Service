import { useRef, useState } from 'react';
import { Button, message, type ButtonProps } from 'antd';
import { getApiErrorMessage } from '../api';

export function ActionButton({
  action,
  ...props
}: Omit<ButtonProps, 'onClick'> & { action: () => Promise<unknown> }) {
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  return (
    <Button
      {...props}
      loading={loading}
      onClick={async () => {
        if (busy.current) return;
        busy.current = true;
        setLoading(true);
        try {
          await action();
        } catch (error) {
          message.error(getApiErrorMessage(error));
        } finally {
          busy.current = false;
          setLoading(false);
        }
      }}
    />
  );
}
