------------------------------------------------------------------------------
--                                                                          --
--                       Copyright (C) 2020, AdaCore                        --
--                                                                          --
--  Redistribution and use in source and binary forms, with or without      --
--  modification, are permitted provided that the following conditions are  --
--  met:                                                                    --
--     1. Redistributions of source code must retain the above copyright    --
--        notice, this list of conditions and the following disclaimer.     --
--     2. Redistributions in binary form must reproduce the above copyright --
--        notice, this list of conditions and the following disclaimer in   --
--        the documentation and/or other materials provided with the        --
--        distribution.                                                     --
--     3. Neither the name of the copyright holder nor the names of its     --
--        contributors may be used to endorse or promote products derived   --
--        from this software without specific prior written permission.     --
--                                                                          --
--   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS    --
--   "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT      --
--   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR  --
--   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT   --
--   HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, --
--   SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT       --
--   LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,  --
--   DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY  --
--   THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT    --
--   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE  --
--   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.   --
--                                                                          --
------------------------------------------------------------------------------
package body LSM303AGR is
   function To_Axis_Data is new Ada.Unchecked_Conversion (UInt10, Axis_Data);

   function Read_Register
     (This : LSM303AGR_Accelerometer'Class; Device_Address : I2C_Address;
      Register_Addr : Register_Address) return UInt8;

   procedure Write_Register
     (This : LSM303AGR_Accelerometer'Class; Device_Address : I2C_Address;
      Register_Addr : Register_Address; Val : UInt8);

   function Check_Device_Id
       (This : LSM303AGR_Accelerometer; Device_Address : I2C_Address;
       WHO_AM_I_Register : Register_Address; Device_Id : Device_Identifier)
      return Boolean;

   function To_Multi_Byte_Read_Address
     (Register_Addr : Register_Address) return UInt16;

   procedure Configure (This : LSM303AGR_Accelerometer; Date_Rate : Data_Rate)
   is
      CTRLA : CTRL_REG1_A_Register;
   begin
      CTRLA.Xen  := 1;
      CTRLA.Yen  := 1;
      CTRLA.Zen  := 1;
      CTRLA.LPen := 0;
      CTRLA.ODR  := Date_Rate'Enum_Rep;

      This.Write_Register
        (Accelerometer_Address, CTRL_REG1_A, To_UInt8 (CTRLA));

      --  CTRLA.Xen  := 0;
      --  CTRLA.Yen  := 0;
      --  CTRLA.Zen  := 0;
      --  CTRLA.LPen := 0;
      --  CTRLA.ODR  := 0;
      --
      --  This.Write_Register
      --    (Magnetometer_Address, CFG_REG_A_M, To_UInt8 (CTRLA));
   end Configure;

   procedure Assert_Status (Status : I2C_Status);
   -------------------
   -- Read_Register --
   -------------------

   function Read_Register
     (This : LSM303AGR_Accelerometer'Class; Device_Address : I2C_Address;
      Register_Addr : Register_Address) return UInt8
   is
      Data   : I2C_Data (1 .. 1);
      Status : I2C_Status;
   begin
      This.Port.Mem_Read
        (Addr          => Device_Address, Mem_Addr => UInt16 (Register_Addr),
         Mem_Addr_Size => Memory_Size_8b, Data => Data, Status => Status);
      Assert_Status (Status);

      return Data (Data'First);
   end Read_Register;

   --------------------
   -- Write_Register --
   --------------------

   procedure Write_Register
     (This : LSM303AGR_Accelerometer'Class; Device_Address : I2C_Address;
      Register_Addr : Register_Address; Val : UInt8)
   is
      Status : I2C_Status;
   begin
      This.Port.Mem_Write
        (Addr          => Device_Address, Mem_Addr => UInt16 (Register_Addr),
         Mem_Addr_Size => Memory_Size_8b, Data => (1 => Val),
         Status        => Status);
      Assert_Status (Status);

   end Write_Register;

   -----------------------------------
   -- Check_Accelerometer_Device_Id --
   -----------------------------------

   function Check_Accelerometer_Device_Id
     (This : LSM303AGR_Accelerometer) return Boolean
   is
   begin
      return
        Check_Device_Id
          (This, Accelerometer_Address, WHO_AM_I_A, Accelerometer_Device_Id);
   end Check_Accelerometer_Device_Id;

   ----------------------------------
   -- Check_Magnetometer_Device_Id --
   ----------------------------------

   function Check_Magnetometer_Device_Id
     (This : LSM303AGR_Accelerometer) return Boolean
   is
   begin
      return
        Check_Device_Id
          (This, Magnetometer_Address, WHO_AM_I_M, Magnetometer_Device_Id);
   end Check_Magnetometer_Device_Id;

   ---------------------
   -- Check_Device_Id --
   ---------------------

   function Check_Device_Id
     (This : LSM303AGR_Accelerometer; Device_Address : I2C_Address;
      WHO_AM_I_Register : Register_Address; Device_Id : Device_Identifier)
      return Boolean
   is
   begin
      return
        Read_Register (This, Device_Address, WHO_AM_I_Register) =
        UInt8 (Device_Id);
   end Check_Device_Id;

   ------------------------
   -- Read_Accelerometer --
   ------------------------

   function Read_Accelerometer
     (This : LSM303AGR_Accelerometer) return All_Axes_Data
   is
      -------------
      -- Convert --
      -------------
      function Convert (Low, High : UInt8) return Axis_Data;
      function Convert (Low, High : UInt8) return Axis_Data is
         Tmp : UInt10;
      begin
          -- TODO: support HiRes and LoPow modes
          -- in conversion.
         Tmp := UInt10 (Shift_Right (Low, 6));
         Tmp := Tmp or UInt10 (High) * 2**2;
         return To_Axis_Data (Tmp);
      end Convert;

      Status   : I2C_Status;
      Data     : I2C_Data (1 .. 6) := (others => 0);
      AxisData : All_Axes_Data     := (X => 0, Y => 0, Z => 0);
   begin
      This.Port.Mem_Read
        (Addr          => Accelerometer_Address,
         Mem_Addr      => To_Multi_Byte_Read_Address (OUT_X_L_A),
         Mem_Addr_Size => Memory_Size_8b, Data => Data, Status => Status);
      Assert_Status (Status);

       -- LSM303AGR has its X-axis in the opposite direction
       -- of the MMA8653FCR1 sensor.
      AxisData.X := Convert (Data (1), Data (2)) * Axis_Data (-1);
      AxisData.Y := Convert (Data (3), Data (4));
      AxisData.Z := Convert (Data (5), Data (6));

      return AxisData;
   end Read_Accelerometer;

   function Read_Accelerometer_Raw
     (This : LSM303AGR_Accelerometer) return All_Axes_Data_Raw
   is
      Status   : I2C_Status;
      Data     : I2C_Data (1 .. 6) := (others => 0);
      AxisData : All_Axes_Data_Raw     := (X => (0,0), Y => (0,0), Z => (0,0));
   begin
      This.Port.Mem_Read
        (Addr          => Accelerometer_Address,
         Mem_Addr      => To_Multi_Byte_Read_Address (OUT_X_L_A),
         Mem_Addr_Size => Memory_Size_8b, Data => Data, Status => Status);
      Assert_Status (Status);

       -- LSM303AGR has its X-axis in the opposite direction
       -- of the MMA8653FCR1 sensor.
      AxisData.X.Low := Data (1);
      AxisData.X.High:= Data (2);
      AxisData.Y.Low := Data (3);
      AxisData.Y.High:= Data (4);
      AxisData.Z.Low := Data (5);
      AxisData.Z.High:= Data (6);
      return AxisData;
   end Read_Accelerometer_Raw;

   function Read_Magnetometer
     (This : LSM303AGR_Accelerometer) return All_Axes_Data
   is
      -------------
      -- Convert --
      -------------
      function Convert (Low, High : UInt8) return Axis_Data;
      function Convert (Low, High : UInt8) return Axis_Data is
         Tmp : UInt10;
      begin
          -- TODO: support HiRes (12 bit)and LoPow (8 bit) modes
          -- in conversion.
          -- current mode is 10 bit, see specsheet https://www.st.com/resource/en/datasheet/lsm303agr.pdf
          -- the output is 2's complement left-justified, meaning that depending on the power mode,
          -- the left most part of low byte (the least significant bits) are zero'd.

         Tmp := UInt10 (Shift_Right (Low, 6));   -- in this case 6 zero's shift right on the low byte.
                                                 -- 0000000000 empty 10 bit
                                                 --   xyz..... low bit
                                                 --   000000xy shift right
                                                 -- resultA is 00000000xy (shift right or empty)
         Tmp := Tmp or UInt10 (High) * 2**2;     -- the 8 bits are put in an empty 10 bit structure, then multiplied with 2²
                                                 -- 0000000000 empty 10 bit
                                                 --   onmlkjih high bit
                                                 -- resultB is 00onmlkjih
                                                 -- multiply with 2^2 (cant we use shift left for this?)
                                                 -- resultB is onmlkjih00
                                                 --
                                                 -- resultA or result B
                                                 -- resultFinal is onmlkjihxy

         return To_Axis_Data (Tmp);
      end Convert;

      Status   : I2C_Status;
      Data     : I2C_Data (1 .. 6) := (others => 0);
      AxisData : All_Axes_Data     := (X => 0, Y => 0, Z => 0);
   begin
      This.Port.Mem_Read
        (Addr          => Magnetometer_Address,
         Mem_Addr      => To_Multi_Byte_Read_Address (OUT_X_L_REG_M),
         Mem_Addr_Size => Memory_Size_8b, Data => Data, Status => Status);
      Assert_Status (Status);

       -- LSM303AGR has its X-axis in the opposite direction
       -- of the MMA8653FCR1 sensor.
      AxisData.X := Convert (Data (1), Data (2)) * Axis_Data (-1);
      AxisData.Y := Convert (Data (3), Data (4));
      AxisData.Z := Convert (Data (5), Data (6));

      return AxisData;
   end Read_Magnetometer;

   function To_Multi_Byte_Read_Address
     (Register_Addr : Register_Address) return UInt16
    -- Based on the i2c behavior of the sensor p.38,
    -- high MSB address allows reading multiple bytes
    -- from slave devices.

   is
   begin
      return UInt16 (Register_Addr) or MULTI_BYTE_READ;
   end To_Multi_Byte_Read_Address;

   procedure Assert_Status (Status : I2C_Status) is
   begin
      if Status /= Ok then
         --  No error handling...
         raise Program_Error;
      end if;
   end Assert_Status;

function Convert (Low, High : UInt8) return Axis_Data is
         Tmp : UInt10;
      begin
          -- TODO: support HiRes and LoPow modes
          -- in conversion.
         Tmp := UInt10 (Shift_Right (Low, 6));
         Tmp := Tmp or UInt10 (High) * 2**2;
         return To_Axis_Data (Tmp);
      end Convert;
end LSM303AGR;
