
--with MicroBit.IOs;
with MicroBit.I2C;
with HAL;
with OV2640;
--with HAL.I2C;
--with ada.Text_IO; use ada.Text_IO;
with MicroBit.Console; use MicroBit.Console;
with MicroBit.Time; use MicroBit.Time;

procedure Main is
   camera : OV2640.OV2640_Camera(MicroBit.I2C.Controller);
   addr : HAL.Uint10 := 16#30#;
 begin
   Put_Line("begin");
   MicroBit.I2C.Initialize;
   Put_Line("post init");
   OV2640.Initialize(camera, addr);

   --Bit7Adress := UInt7(addr/2);
   --OV2640.Set_Frame_Size(camera,OV2640.CIF);
   --OV2640.Set_Pixel_Format(camera,OV2640.Pix_RGB565);
   --OV2640.Set_Frame_Rate(camera,OV2640.FR_60FPS);
   --OV2640.Read();

   loop
      Put_Line("tst loop");
      Delay_Ms(1000);
   end loop;
end Main;
